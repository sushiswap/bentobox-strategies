// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../BaseStrategy.sol";
import "../interfaces/ISushiSwap.sol";
import "../interfaces/IMasterChef.sol";
import "../libraries/Babylonian.sol";

import "hardhat/console.sol";

contract LPStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    uint256 constant deadline = 0xf000000000000000000000000000000000000000000000000000000000000000; // ~ placeholder for swap deadline

    ISushiSwap private immutable router;
    IMasterChef private immutable masterchef;
    uint256 private immutable pid;
    address private immutable rewardToken;
    bool private immutable usePairToken0;
    address private immutable pairInputToken;

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _factory SushiSwap factory.
        @param _bridgeToken An intermediary token for swapping any rewards into it before swapping it to _inputPairToken
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
        @param _usePairToken0 When true, the _rewardToken will be swapped to the pair's token0 for one-sided liquidity
                                providing, otherwise, the pair's token1.
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _factory,
        address _bridgeToken,
        address _strategyExecutor,
        IMasterChef _masterchef,
        uint256 _pid,
        ISushiSwap _router,
        address _rewardToken,
        bool _usePairToken0
    ) BaseStrategy(_strategyToken, _bentoBox, _factory, _bridgeToken, _strategyExecutor) {
        masterchef = _masterchef;
        pid = _pid;
        router = _router;
        rewardToken = _rewardToken;
        (address token0, address token1) = _getPairTokens(_strategyToken);
        IERC20(token0).safeApprove(address(_router), type(uint256).max);
        IERC20(token1).safeApprove(address(_router), type(uint256).max);
        IERC20(_strategyToken).safeApprove(address(_masterchef), type(uint256).max);

        usePairToken0 = _usePairToken0;
        pairInputToken = _usePairToken0 ? token0 : token1;
    }

    function _skim(uint256 amount) internal override {
        masterchef.deposit(pid, amount);
    }

    function _harvest(uint256 balanceToKeep) internal override returns (int256) {
        console.log("wut...");
        // claim the reward tokens
        masterchef.withdraw(pid, 0);

        // mint new LPs by selling the reward tokens
        uint256 amountMinted = _swapToLp();

        (uint256 amountStaked, ) = masterchef.userInfo(pid, address(this));
        uint256 total = amountMinted + amountStaked;

        // Remove excess balance from this strategy according to balanceToKeep
        if (balanceToKeep < total) {
            uint256 amountOut = total - balanceToKeep;

            // edge case where the number of minted lp from rewards
            // exceeds the deposited amount
            if (amountMinted > amountOut) {
                masterchef.deposit(pid, amountMinted - amountOut);
            } else {
                // removed newly amount from amount to exit as it's
                // already unstaked.
                amountOut -= amountMinted;
            }

            if (amountOut > 0) {
                masterchef.withdraw(pid, amountOut);
            }
        } else {
            masterchef.deposit(pid, amountMinted);
        }

        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        masterchef.withdraw(pid, amount);
    }

    function _exit() internal override {
        masterchef.emergencyWithdraw(pid);
    }

    function _getPairTokens(address _pairAddress) private pure returns (address token0, address token1) {
        ISushiSwap sushiPair = ISushiSwap(_pairAddress);
        token0 = sushiPair.token0();
        token1 = sushiPair.token1();
    }

    function _swapTokensForUnderlying(address tokenIn, address tokenOut) private returns (uint256 amountOut) {
        bool useBridge = bridgeToken != address(0);
        address[] memory path = new address[](useBridge ? 3 : 2);

        path[0] = tokenIn;
        if (useBridge) {
            path[1] = bridgeToken;
        }
        path[path.length - 1] = tokenOut;

        uint256 amountIn = IERC20(path[0]).balanceOf(address(this));
        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);
        amountOut = amounts[amounts.length - 1];

        IERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(factory, path[0], path[1]), amounts[0]);

        _swap(amounts, path, address(this));
    }

    function _calculateSwapInAmount(uint256 reserveIn, uint256 userIn) private pure returns (uint256) {
        return (Babylonian.sqrt(reserveIn * userIn * 3988000 + reserveIn * 3988009) - reserveIn * 1997) / 1994;
    }

    /// @notice Swap some tokens in the contract for the underlying and deposits them to address(this)
    function _swapToLp() private returns (uint256 amountOut) {
        uint256 tokenInAmount = _swapTokensForUnderlying(rewardToken, pairInputToken);
        (uint256 reserve0, uint256 reserve1, ) = ISushiSwap(strategyToken).getReserves();
        (address token0, address token1) = _getPairTokens(strategyToken);

        // The pairInputToken amount to swap to get the equivalent pair second token amount
        uint256 swapAmountIn = _calculateSwapInAmount(tokenInAmount, usePairToken0 ? reserve0 : reserve1);

        address[] memory path = new address[](2);
        if (usePairToken0) {
            path[0] = token0;
            path[1] = token1;
        } else {
            path[0] = token1;
            path[1] = token0;
        }
    
        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, swapAmountIn, path);
        IERC20(path[0]).safeTransfer(strategyToken, amounts[0]);
        _swap(amounts, path, address(this));
        uint256 pairInputTokenAmount = IERC20(pairInputToken).balanceOf(address(this));

        uint256 amountStrategyLpBefore = IERC20(strategyToken).balanceOf(address(this));
        router.addLiquidity(
            token0,
            token1,
            usePairToken0 ? pairInputTokenAmount : amounts[0],
            usePairToken0 ? amounts[0] : pairInputTokenAmount,
            1,
            1,
            address(this),
            deadline
        );

        amountOut = IERC20(strategyToken).balanceOf(address(this)) - amountStrategyLpBefore;
    }
}
