// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.7;

interface IMiniChefV2 {
    function deposit(
        uint256 _pid,
        uint256 _amount,
        address _to
    ) external;

    function withdraw(
        uint256 _pid,
        uint256 _amount,
        address _to
    ) external;

    function userInfo(uint256 _pid, address user) external view returns (uint256 amount, uint256 rewardDebt);

    function emergencyWithdraw(uint256 _pid, address _to) external;

    function harvest(uint256 _pid, address _to) external;

    function rewardsExpiration() external view returns (uint256);

    function fundRewards(uint256 funding, uint256 duration) external;

    function resetRewardsDuration(uint256 duration) external;
}
