// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "./IOracle.sol";

interface IDynamicSubLPStrategy {
    function dynamicStrategy() external view returns (address);

    function skim(uint256 amount) external;

    function harvest() external returns (uint256 amountAdded);

    function withdraw(uint256 amount) external returns (uint256 actualAmount);

    function exit() external returns (uint256 actualAmount);

    function strategyTokenIn() external view returns (address);

    function strategyTokenOut() external view returns (address);

    function wrapAndDeposit(uint256 minDustAmount0, uint256 minDustAmount1) external returns (uint256 amount, uint256 amountPrice);

    function withdrawAndUnwrapTo(IDynamicSubLPStrategy recipient) external returns (uint256 amount, uint256 amountPrice);

    function rescueTokens(
        address token,
        address to,
        uint256 amount
    ) external;

    function swapToLP(
        uint256 amountOutMin,
        uint256 feePercent,
        address feeTo
    ) external returns (uint256 amountOut);
}
