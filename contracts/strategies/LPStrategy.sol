// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "../BaseStrategy.sol";
import "../interfaces/ISushiSwap.sol";
import "../libraries/Babylonian.sol";

interface IMasterChef {
    function deposit(uint256 _pid, uint256 _amount) external;
    // Withdraw LP tokens from MasterChef.
    function withdraw(uint256 _pid, uint256 _amount) external;
    function userInfo(uint256 _pid, address user) external returns(uint256 amount, uint256 rewardDebt);
    function emergencyWithdraw(uint256 _pid) external;
}

contract LPStrategy is BaseStrategy {
    address constant sushiSwapFactory = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac; // SushiSwap factory contract
    address constant wETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // ETH wrapper contract v9
    ISushiSwap constant sushiSwapRouter = ISushiSwap(0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F); // SushiSwap router contract
    uint256 constant deadline = 0xf000000000000000000000000000000000000000000000000000000000000000; // ~ placeholder for swap deadline
    IMasterChef public immutable masterchef;
    uint256 private immutable pid;
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _strategyExecutor,
        address _bridgeToken,
        IMasterChef _masterchef,
        uint256 _pid
    ) BaseStrategy(_strategyToken, _bentoBox, sushiSwapFactory, _bridgeToken, _strategyExecutor)  {
        masterchef = _masterchef;
        pid = _pid;
        (address token0, address token1) = _getPairTokens(_strategyToken);
        IERC20(token0).safeApprove(
            address(sushiSwapRouter),
            type(uint256).max
        );
        IERC20(token1).safeApprove(
            address(sushiSwapRouter),
            type(uint256).max
        );
    }

    function _skim(uint256 amount) internal override {
        masterchef.deposit(pid, amount);
    }

    function _harvest(uint256 balance) internal override returns (int256 amountAdded) {
        masterchef.withdraw(pid, 0);
    }

    function _withdraw(uint256 amount) internal override {
        masterchef.withdraw(pid, amount);
    }

    function _exit() internal override {
        masterchef.emergencyWithdraw(pid);
    }

    function _getPairTokens(address _pairAddress) private pure returns (address token0, address token1)
    {
        ISushiSwap sushiPair = ISushiSwap(_pairAddress);
        token0 = sushiPair.token0();
        token1 = sushiPair.token1();
    }

    function _swapFirst(address inputToken) internal returns (uint256 amountOut, address _bridgeToken) {

        address[] memory path = new address[](2);

        path[0] = inputToken;

        _bridgeToken = bridgeToken;

        path[1] = _bridgeToken;

        uint256 amountIn = IERC20(path[0]).balanceOf(address(this));

        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);

        amountOut = amounts[amounts.length - 1];

        IERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(factory, path[0], path[1]), amounts[0]);

        _swap(amounts, path, address(this));
    }

    function _swapIntermediate(
        address tokenFrom,
        address _ToSushipoolToken0,
        address _ToSushipoolToken1,
        uint256 _amount,
        address _pairAddress
    ) private returns (uint256 token0Bought, uint256 token1Bought) {
        ISushiSwap pair = ISushiSwap(_pairAddress);
        (uint256 res0, uint256 res1, ) = pair.getReserves();

        uint256 amountIn;
        address[] memory path = new address[](useBridge ? 3 : 2);
        path[0] = tokenFrom;
        uint256[] memory amounts;

        if (tokenFrom == _ToSushipoolToken0) {
            amountIn = calculateSwapInAmount(res0, _amount);
            path[1] = _ToSushipoolToken1;
            amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);
            token1Bought = amounts[amounts.length - 1];
            token0Bought = _amount - amountToSwap;
        } else {
            amountIn = calculateSwapInAmount(res1, _amount);
            path[1] = _ToSushipoolToken1;
            amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);
            token0Bought = amounts[amounts.length - 1];
            token1Bought = _amount - amountToSwap;
        }

        IERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(factory, path[0], path[1]), amounts[0]);

        _swap(amounts, path, address(this));
    }

    function calculateSwapInAmount(uint256 reserveIn, uint256 userIn) private pure returns (uint256)
    {
        return
            (Babylonian
                .sqrt(
                reserveIn * userIn * 3988000 + reserveIn * 3988009
            )
                - reserveIn * 1997) / 1994;
    }

    /// @notice Swap some tokens in the contract for the underlying and deposits them to address(this)
    function swapToLP(uint256 amountOutMin, address inputToken) public onlyExecutor returns (uint256 amountOut) {
        uint256 intermediateAmt;
        address intermediateToken;
        address _pairAddress = strategyToken;
        (
            address _ToSushipoolToken0,
            address _ToSushipoolToken1
        ) = _getPairTokens(_pairAddress);

        if (
            _FromTokenContractAddress != _ToSushipoolToken0 &&
            _FromTokenContractAddress != _ToSushipoolToken1
        ) {
            // swap to intermediate
            (intermediateAmt, intermediateToken) = _swapFirst(inputToken);
        } else {
            intermediateToken = inputToken;
            intermediateAmt = IERC20(inputToken).balanceOf(address(this));
        }
        // divide intermediate into appropriate amount to add liquidity
        (uint256 token0Bought, uint256 token1Bought) = _swapIntermediate(
            intermediateToken,
            _ToSushipoolToken0,
            _ToSushipoolToken1,
            _pairAddress
        );

        (, uint256 LPBought) = sushiSwapRouter
            .addLiquidity(
            _ToSushipoolToken0,
            _ToSushipoolToken1,
            token0Bought,
            token1Bought,
            1,
            1,
            address(this),
            deadline
        );

        require(LPBought >= amountOutMin, 'ERR: High Slippage');
    }
}
