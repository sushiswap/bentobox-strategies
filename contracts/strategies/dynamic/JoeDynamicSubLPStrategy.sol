// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "../../interfaces/IMasterChef.sol";
import "./DynamicSubLPStrategy.sol";

contract JoeDynamicSubLPStrategy is DynamicSubLPStrategy {
    using SafeTransferLib for ERC20;

    IMasterChef public immutable masterchef;

    constructor(
        address _bentoBox,
        address _dynamicStrategy,
        address _strategyTokenIn,
        address _strategyTokenOut,
        IOracle _oracle,
        IMasterChef _masterchef,
        address _rewardToken,
        uint8 _pid,
        bool _usePairToken0,
        RouterInfo memory _strategyTokenInInfo,
        RouterInfo memory _strategyTokenOutInfo
    )
        DynamicSubLPStrategy(
            _bentoBox,
            _dynamicStrategy,
            _strategyTokenIn,
            _strategyTokenOut,
            _oracle,
            _rewardToken,
            _pid,
            _usePairToken0,
            _strategyTokenInInfo,
            _strategyTokenOutInfo
        )
    {
        masterchef = _masterchef;
        ERC20(_strategyTokenIn).safeApprove(address(_masterchef), type(uint256).max);
    }

    function _deposit(uint256 amount) internal override {
        masterchef.deposit(pid, amount);
    }

    function _withdraw(uint256 amount) internal override {
        masterchef.withdraw(pid, amount);
    }

    function _claimRewards() internal override {
        masterchef.withdraw(pid, 0);
    }

    function _userInfo() internal view virtual override returns (uint256 amount, uint256 rewardDebt) {
        return masterchef.userInfo(pid, address(this));
    }

    function _emergencyWithdraw() internal override {
        masterchef.emergencyWithdraw(pid);
    }
}
