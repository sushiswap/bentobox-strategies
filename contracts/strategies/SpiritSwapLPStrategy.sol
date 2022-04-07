// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";

import "../BaseStrategy.sol";
import "../interfaces/ISushiSwap.sol";
import "../interfaces/ISpiritSwapGauge.sol";
import "../libraries/Babylonian.sol";

contract SpiritSwapLPStrategy is BaseStrategy {
    using SafeTransferLib for ERC20;

    error InsufficientAmountOut();
    error InvalidFeePercent();

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);

    bytes32 internal constant PAIR_CODE_HASH = 0xe242e798f6cee26a9cb0bbf24653bf066e5356ffeac160907fe2cc108e238617;
    ISushiSwap internal constant ROUTER = ISushiSwap(0x16327E3FbDaCA3bcF7E38F5Af2599D2DDc33aE52);

    ISpiritSwapGauge private immutable gauge;

    address private immutable rewardToken;
    address private immutable pairInputToken;
    bool private immutable usePairToken0;

    address public feeCollector;
    uint8 public feePercent;

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _factory SushiSwap factory.
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
        @param _gauge The spiritswap gauge farm
        @param _rewardToken The gauge reward token
        @param _usePairToken0 When true, the _rewardToken will be swapped to the pair's token0 for one-sided liquidity
                                providing, otherwise, the pair's token1.
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _factory,
        address _strategyExecutor,
        ISpiritSwapGauge _gauge,
        address _rewardToken,
        bool _usePairToken0
    ) BaseStrategy(_strategyToken, _bentoBox, _factory, address(0), _strategyExecutor, PAIR_CODE_HASH) {
        gauge = _gauge;
        rewardToken = _rewardToken;
        feeCollector = _msgSender();

        (address token0, address token1) = _getPairTokens(_strategyToken);
        ERC20(token0).safeApprove(address(ROUTER), type(uint256).max);
        ERC20(token1).safeApprove(address(ROUTER), type(uint256).max);
        ERC20(_strategyToken).safeApprove(address(_gauge), type(uint256).max);

        usePairToken0 = _usePairToken0;
        pairInputToken = _usePairToken0 ? token0 : token1;
    }

    function _skim(uint256 amount) internal override {
        gauge.deposit(amount);
    }

    function _harvest(uint256) internal override returns (int256) {
        gauge.getReward();
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        gauge.withdraw(amount);
    }

    function _exit() internal override {
        gauge.withdrawAll();
    }

    function _getPairTokens(address _pairAddress) private pure returns (address token0, address token1) {
        ISushiSwap sushiPair = ISushiSwap(_pairAddress);
        token0 = sushiPair.token0();
        token1 = sushiPair.token1();
    }

    function _swapTokens(address tokenIn, address tokenOut) private returns (uint256 amountOut) {
        bool useBridge = bridgeToken != address(0);
        address[] memory path = new address[](useBridge ? 3 : 2);

        path[0] = tokenIn;

        if (useBridge) {
            path[1] = bridgeToken;
        }

        path[path.length - 1] = tokenOut;

        uint256 amountIn = ERC20(path[0]).balanceOf(address(this));
        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path, pairCodeHash);
        amountOut = amounts[amounts.length - 1];

        ERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(factory, path[0], path[1], pairCodeHash), amounts[0]);
        _swap(amounts, path, address(this));
    }

    function _calculateSwapInAmount(uint256 reserveIn, uint256 userIn) internal pure returns (uint256) {
        return (Babylonian.sqrt(reserveIn * ((userIn * 3988000) + (reserveIn * 3988009))) - (reserveIn * 1997)) / 1994;
    }

    /// @notice Swap some tokens in the contract for the underlying and deposits them to address(this)
    function swapToLP(uint256 amountOutMin) public onlyExecutor returns (uint256 amountOut) {
        uint256 tokenInAmount = _swapTokens(rewardToken, pairInputToken);
        (uint256 reserve0, uint256 reserve1, ) = ISushiSwap(strategyToken).getReserves();
        (address token0, address token1) = _getPairTokens(strategyToken);

        // The pairInputToken amount to swap to get the equivalent pair second token amount
        uint256 swapAmountIn = _calculateSwapInAmount(usePairToken0 ? reserve0 : reserve1, tokenInAmount);

        address[] memory path = new address[](2);
        if (usePairToken0) {
            path[0] = token0;
            path[1] = token1;
        } else {
            path[0] = token1;
            path[1] = token0;
        }

        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, swapAmountIn, path, pairCodeHash);
        ERC20(path[0]).safeTransfer(strategyToken, amounts[0]);
        _swap(amounts, path, address(this));

        uint256 amountStrategyLpBefore = ERC20(strategyToken).balanceOf(address(this));

        // Minting liquidity with optimal token balances but is still leaving some
        // dust because of rounding. The dust will be used the next time the function
        // is called.
        ROUTER.addLiquidity(
            token0,
            token1,
            ERC20(token0).balanceOf(address(this)),
            ERC20(token1).balanceOf(address(this)),
            1,
            1,
            address(this),
            type(uint256).max
        );

        uint256 total = ERC20(strategyToken).balanceOf(address(this)) - amountStrategyLpBefore;
        if (total < amountOutMin) {
            revert InsufficientAmountOut();
        }

        uint256 feeAmount = (total * feePercent) / 100;

        if (feeAmount > 0) {
            amountOut = total - feeAmount;
            ERC20(strategyToken).safeTransfer(feeCollector, feeAmount);
        }

        emit LpMinted(total, amountOut, feeAmount);
    }

    function setFeeParameters(address _feeCollector, uint8 _feePercent) external onlyOwner {
        if (feePercent > 100) {
            revert InvalidFeePercent();
        }

        feeCollector = _feeCollector;
        feePercent = _feePercent;
    }
}
