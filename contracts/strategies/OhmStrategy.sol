// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "../BaseStrategy.sol";

interface IStakingManager {
    function unstake( uint _amount, bool _trigger ) external;
    function stake( uint _amount, address _recipient ) external returns ( bool );
    function claim ( address _recipient ) external;
    function rebase() external;
}

contract OhmStrategy is BaseStrategy {
    IERC20 public constant OHM = IERC20(0x383518188C0C6d7730D91b2c03a03C837814a899);
    IStakingManager public constant STAKING_MANAGER = IStakingManager(0xFd31c7d00Ca47653c6Ce64Af53c1571f9C36566a);
    IERC20 public constant SOHM = IERC20(0x04F2694C8fcee23e8Fd0dfEA1d4f5Bb8c352111F);        

    constructor(
        address strategyExecutor
    ) BaseStrategy(address(OHM), 0xF5BCE5077908a1b7370B9ae04AdC565EBd643966, strategyExecutor, address(0), address(0)) {
        OHM.approve(address(STAKING_MANAGER), type(uint256).max);
    }

    function _skim(uint256 amount) internal override {
        // Necessary requirement that OHM does not introduce a delay time here
        // Could be introduced by governance
        STAKING_MANAGER.stake(amount, address(this));
        STAKING_MANAGER.claim(address(this));
    }

    function _harvest(uint256 balance) internal override returns (int256) {
        uint256 total = SOHM.balanceOf(address(this));
        if (total > balance) STAKING_MANAGER.unstake(total - balance, false);
        // sOHM can't report a loss so no need to check for keep < total case
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        STAKING_MANAGER.unstake(amount, false);
    }

    function _exit() internal override {
        STAKING_MANAGER.rebase();
        uint256 total = SOHM.balanceOf(address(this));
        STAKING_MANAGER.unstake(total, false);
    }
}
