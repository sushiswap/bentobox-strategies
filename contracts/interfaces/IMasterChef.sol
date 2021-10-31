// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.7;

interface IMasterChef {
    function deposit(uint256 _pid, uint256 _amount) external;
    function withdraw(uint256 _pid, uint256 _amount) external;
    function userInfo(uint256 _pid, address user) external view returns (uint256 amount, uint256 rewardDebt);
    function emergencyWithdraw(uint256 _pid) external;
}