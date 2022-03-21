// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../BaseStrategy.sol";
import "../../interfaces/ISushiSwap.sol";
import "../../interfaces/IDynamicSubLPStrategy.sol";
import "../../interfaces/IOracle.sol";
import "../../libraries/Babylonian.sol";

/// @notice DynamicSubLPStrategy sub-strategy for uniswap-forks with 0.3% fees
/// @dev For gas saving, the strategy directly transfers to bentobox instead
/// of transfering to DynamicLPStrategy. This contract is made abstract so we can
/// implements fork specificities.
abstract contract DynamicSubLPStrategy is IDynamicSubLPStrategy, Ownable {
    using SafeTransferLib for ERC20;

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);

    struct RouterInfo {
        address factory;
        ISushiSwap router;
        bytes32 pairCodeHash;
    }

    address public immutable override dynamicStrategy;
    address public immutable override strategyTokenIn;
    address public immutable override strategyTokenOut;

    IOracle public immutable oracle;
    address public immutable bentoBox;
    uint8 public immutable pid;

    /// @notice When true, the _rewardToken will be swapped to the pair's
    /// token0 for one-sided liquidity providing, otherwise, the pair's token1.
    bool public usePairToken0;

    /// @notice cache of the strategyTokenOut token used to first swap the token rewards to before
    /// splitting the liquidity in half for minting strategyTokenIn
    address public immutable pairInputToken;

    /// @notice the token farmed by staking strategyTokenIn in masterchef
    address public immutable rewardToken;

    RouterInfo public strategyTokenInInfo;
    RouterInfo public strategyTokenOutInfo;

    event LogSetStrategyExecutor(address indexed executor, bool allowed);

    /** 
        @param _bentoBox BentoBox address.
        @param _dynamicStrategy The dynamic strategy this sub strategy belongs to
        @param _strategyTokenIn Address of the LP token the strategy is farming with
        @param _strategyTokenOut Address of the LP token the strategy is swapping the rewardTokens to
        @param _oracle The oracle to price the strategyTokenOut. peekSpot needs to send the inverse price in USD
        @param _rewardToken The token the staking is farming
        @param _pid The masterchef pool id for strategyTokenIn staking
        @param _usePairToken0 When true, the _rewardToken will be swapped to the pair's token0 for one-sided liquidity
                                providing, otherwise, the pair's token1.
        @param _strategyTokenInInfo The router information to wrap strategyTokenIn from token0 and token1
        @param _strategyTokenOutInfo The router information to swap the reward tokens for more strategyTokenOut
    */
    constructor(
        address _bentoBox,
        address _dynamicStrategy,
        address _strategyTokenIn,
        address _strategyTokenOut,
        IOracle _oracle,
        address _rewardToken,
        uint8 _pid,
        bool _usePairToken0,
        RouterInfo memory _strategyTokenInInfo,
        RouterInfo memory _strategyTokenOutInfo
    ) {
        bentoBox = _bentoBox;
        dynamicStrategy = _dynamicStrategy;
        strategyTokenIn = _strategyTokenIn;
        strategyTokenOut = _strategyTokenOut;
        oracle = _oracle;
        rewardToken = _rewardToken;
        pid = _pid;
        usePairToken0 = _usePairToken0;
        strategyTokenInInfo = _strategyTokenInInfo;
        strategyTokenOutInfo = _strategyTokenOutInfo;

        ERC20(_strategyTokenIn).safeApprove(address(_strategyTokenInInfo.router), type(uint256).max);

        // For wrapping from token0 and token1 to strategyTokenIn
        address token0 = ISushiSwap(_strategyTokenIn).token0();
        address token1 = ISushiSwap(_strategyTokenIn).token1();
        ERC20(token0).safeApprove(address(_strategyTokenInInfo.router), type(uint256).max);
        ERC20(token1).safeApprove(address(_strategyTokenInInfo.router), type(uint256).max);

        // For swapping the reward tokens to strategyTokenOut
        token0 = ISushiSwap(_strategyTokenOut).token0();
        token1 = ISushiSwap(_strategyTokenOut).token1();
        ERC20(token0).safeApprove(address(_strategyTokenOutInfo.router), type(uint256).max);
        ERC20(token1).safeApprove(address(_strategyTokenOutInfo.router), type(uint256).max);
        pairInputToken = _usePairToken0 ? token0 : token1;
    }

    modifier onlyDynamicStrategy() {
        require(msg.sender == dynamicStrategy, "unauthorized");
        _;
    }

    function skim(uint256 amount) external override onlyDynamicStrategy {
        _deposit(amount);
    }

    /// @dev harvest the rewardToken from masterchef and send the strategyTokenOut to bentobox.
    /// strategyTokenOut can be obtained by calling swapToLP to swap the reward token for
    /// more strategyTokenOut. In this case, a subsequent call to harvest is necessary for the
    /// strategyTokenOut tokens to be available for transfer.
    function harvest() external override onlyDynamicStrategy returns (uint256 amountAdded) {
        _claimRewards();

        /// @dev transfer the strategyTokenOut to bentobox directly and
        /// report the amount added.
        amountAdded = ERC20(strategyTokenOut).balanceOf(address(this));
        ERC20(strategyTokenOut).safeTransfer(bentoBox, amountAdded);
    }

    /// @dev withdraw the specified amount from masterchef.
    /// Only to be used when the strategyTokenIn matches the dyanmic strategyToken.
    /// (validated inside DynamicLPStrategy.withdraw)
    function withdraw(uint256 amount) external override onlyDynamicStrategy returns (uint256 actualAmount) {
        _withdraw(amount);

        actualAmount = ERC20(strategyTokenIn).balanceOf(address(this));
        ERC20(strategyTokenIn).safeTransfer(bentoBox, actualAmount);
    }

    /// @dev exit everything from masterchef.
    /// Only to be used when the strategyTokenIn matches the dyanmic strategyToken.
    /// (validated inside DynamicLPStrategy.exit)
    function exit() external override onlyDynamicStrategy returns (uint256 actualAmount) {
        _emergencyWithdraw();

        actualAmount = ERC20(strategyTokenIn).balanceOf(address(this));
        ERC20(strategyTokenIn).safeTransfer(bentoBox, actualAmount);
    }

    /// @notice Swap token0 and token1 in the contract for deposits them to address(this)
    function swapToLP(
        uint256 amountOutMin,
        uint256 feePercent,
        address feeTo
    ) public override onlyDynamicStrategy returns (uint256 amountOut) {
        RouterInfo memory _strategyTokenOutInfo = strategyTokenOutInfo;

        uint256 tokenInAmount = _swapTokens(rewardToken, pairInputToken, _strategyTokenOutInfo.factory, _strategyTokenOutInfo.pairCodeHash);
        (uint256 reserve0, uint256 reserve1, ) = ISushiSwap(strategyTokenOut).getReserves();
        address token0 = ISushiSwap(strategyTokenOut).token0();
        address token1 = ISushiSwap(strategyTokenOut).token1();

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

        uint256[] memory amounts = UniswapV2Library.getAmountsOut(
            _strategyTokenOutInfo.factory,
            swapAmountIn,
            path,
            _strategyTokenOutInfo.pairCodeHash
        );
        ERC20(path[0]).safeTransfer(strategyTokenOut, amounts[0]);
        _swap(amounts, path, address(this), _strategyTokenOutInfo.factory, _strategyTokenOutInfo.pairCodeHash);

        uint256 amountStrategyLpBefore = ERC20(strategyTokenOut).balanceOf(address(this));

        // Minting liquidity with optimal token balances but is still leaving some
        // dust because of rounding. The dust will be used the next time the function
        // is called.
        _strategyTokenOutInfo.router.addLiquidity(
            token0,
            token1,
            ERC20(token0).balanceOf(address(this)),
            ERC20(token1).balanceOf(address(this)),
            1,
            1,
            address(this),
            type(uint256).max
        );

        uint256 total = ERC20(strategyTokenOut).balanceOf(address(this)) - amountStrategyLpBefore;
        require(total >= amountOutMin, "INSUFFICIENT_AMOUNT_OUT");

        uint256 feeAmount = (total * feePercent) / 100;

        if (feeAmount > 0) {
            amountOut = total - feeAmount;
            ERC20(strategyTokenOut).safeTransfer(feeTo, feeAmount);
        }

        emit LpMinted(total, amountOut, feeAmount);
    }

    /// @notice wrap the token0 and token1 deposited into the contract from a previous withdrawAndUnwrapTo
    /// and wrap into a strategyTokenIn lp token.
    /// @param minDustAmount0 the minimum token0 left after the first addLiquidity to consider
    /// swapping into more strategyTokenIn Lps
    /// @param minDustAmount1 same as `minDustAmount0` but for token1
    function wrapAndDeposit(uint256 minDustAmount0, uint256 minDustAmount1)
        external
        override
        onlyDynamicStrategy
        returns (uint256 amount, uint256 priceAmount)
    {
        RouterInfo memory _strategyTokenInInfo = strategyTokenInInfo;
        address token0 = ISushiSwap(strategyTokenIn).token0();
        address token1 = ISushiSwap(strategyTokenIn).token1();

        uint256 token0Balance = ERC20(token0).balanceOf(address(this));
        uint256 token1Balance = ERC20(token1).balanceOf(address(this));

        // swap ideal amount of token0 and token1. This is likely leave some
        // token0 or token1
        (uint256 idealAmount0, uint256 idealAmount1, uint256 lpAmount) = _strategyTokenInInfo.router.addLiquidity(
            token0,
            token1,
            token0Balance,
            token1Balance,
            1,
            1,
            address(this),
            type(uint256).max
        );

        (uint256 reserve0, uint256 reserve1, ) = ISushiSwap(strategyTokenIn).getReserves();

        // take the remaining token0 or token1 left from addliquidity and one
        // side liquidity provide with it
        token0Balance = token0Balance - idealAmount0;
        token1Balance = token1Balance - idealAmount1;

        if (token0Balance >= minDustAmount0 && token1Balance >= minDustAmount1) {
            // swap remaining token0 in the contract
            if (token0Balance > 0) {
                uint256 swapAmountIn = _calculateSwapInAmount(reserve0, token0Balance);

                token0Balance -= swapAmountIn;
                token1Balance = _getAmountOut(swapAmountIn, reserve0, reserve1);

                ERC20(token0).safeTransfer(strategyTokenIn, swapAmountIn);
                ISushiSwap(strategyTokenIn).swap(0, token1Balance, address(this), "");
            }
            // swap remaining token1 in the contract
            else {
                uint256 swapAmountIn = _calculateSwapInAmount(reserve1, token1Balance);

                token1Balance -= swapAmountIn;
                token0Balance = _getAmountOut(swapAmountIn, reserve1, reserve0);

                ERC20(token1).safeTransfer(strategyTokenIn, swapAmountIn);
                ISushiSwap(strategyTokenIn).swap(token0Balance, 0, address(this), "");
            }

            if (token0Balance > 0 && token1Balance > 0) {
                (, , uint256 lpAmountFromRemaining) = _strategyTokenInInfo.router.addLiquidity(
                    token0,
                    token1,
                    token0Balance,
                    token1Balance,
                    1,
                    1,
                    address(this),
                    type(uint256).max
                );

                lpAmount += lpAmountFromRemaining;
            }
        }

        amount = lpAmount;
        _deposit(lpAmount);
        priceAmount = (amount * 1e18) / oracle.peekSpot("");
        emit LpMinted(lpAmount, lpAmount, 0);
    }

    /// @notice withdraw from masterchef and unwrap token0 and token1 to recipient, so that
    /// the next strategy can use the liquidity and wrap it back.
    /// Note: this function will potentially leave out some reward tokens, so the harvest/swapToLp/harvest routine
    /// should be run beforehand.
    function withdrawAndUnwrapTo(IDynamicSubLPStrategy recipient)
        external
        override
        onlyDynamicStrategy
        returns (uint256 amount, uint256 priceAmount)
    {
        (uint256 stakedAmount, ) = _userInfo();
        _withdraw(stakedAmount);

        address token0 = ISushiSwap(strategyTokenIn).token0();
        address token1 = ISushiSwap(strategyTokenIn).token1();
        amount = ERC20(strategyTokenIn).balanceOf(address(this));

        /// @dev calculate the price before removing the liquidity
        priceAmount = (amount * 1e18) / oracle.peekSpot("");
        ISushiSwap(strategyTokenInInfo.router).removeLiquidity(token0, token1, amount, 0, 0, address(recipient), type(uint256).max);
    }

    /// @notice emergency function in case of fund locked.
    function rescueTokens(
        address token,
        address to,
        uint256 amount
    ) external override onlyOwner {
        ERC20(token).safeTransfer(to, amount);
    }

    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to,
        address _factory,
        bytes32 _pairCodeHash
    ) private {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address token0 = input < output ? input : output;
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address to = i < path.length - 2 ? UniswapV2Library.pairFor(_factory, output, path[i + 2], _pairCodeHash) : _to;
            IUniswapV2Pair(UniswapV2Library.pairFor(_factory, input, output, _pairCodeHash)).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function _swapTokens(
        address tokenIn,
        address tokenOut,
        address _factory,
        bytes32 _pairCodeHash
    ) private returns (uint256 amountOut) {
        address[] memory path = new address[](2);

        path[0] = tokenIn;

        path[path.length - 1] = tokenOut;

        uint256 amountIn = ERC20(path[0]).balanceOf(address(this));
        uint256[] memory amounts = UniswapV2Library.getAmountsOut(_factory, amountIn, path, _pairCodeHash);
        amountOut = amounts[amounts.length - 1];

        ERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(_factory, path[0], path[1], _pairCodeHash), amounts[0]);
        _swap(amounts, path, address(this), _factory, _pairCodeHash);
    }

    function _calculateSwapInAmount(uint256 reserveIn, uint256 amountIn) internal pure returns (uint256) {
        return (Babylonian.sqrt(reserveIn * ((amountIn * 3988000) + (reserveIn * 3988009))) - (reserveIn * 1997)) / 1994;
    }

    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /// @dev force to reimplement masterchef interface for common staking interface
    function _deposit(uint256 amount) internal virtual;

    function _claimRewards() internal virtual;

    function _withdraw(uint256 amount) internal virtual;

    function _userInfo() internal view virtual returns (uint256 amount, uint256 rewardDebt);

    function _emergencyWithdraw() internal virtual;
}
