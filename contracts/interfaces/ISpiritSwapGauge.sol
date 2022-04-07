// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

interface ISpiritSwapGauge {
    function depositAll() external;

    function deposit(uint256 amount) external;

    function depositFor(uint256 amount, address account) external;

    function getReward() external;

    function withdrawAll() external;

    function withdraw(uint256 amount) external;

    function balanceOf(address account) external view returns (uint256);

    function notifyRewardAmount(uint256 reward) external;
}
