// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "../../interfaces/IMiniChefV2.sol";
import "./DynamicSubLPStrategy.sol";

contract PangolinDynamicSubLPStrategy is DynamicSubLPStrategy {
    using SafeTransferLib for ERC20;

    IMiniChefV2 public immutable minichef;

    constructor(
        address _bentoBox,
        address _dynamicStrategy,
        address _strategyTokenIn,
        address _strategyTokenOut,
        IOracle _oracle,
        IMiniChefV2 _minichef,
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
        minichef = _minichef;
        ERC20(_strategyTokenIn).safeApprove(address(_minichef), type(uint256).max);
    }

    function _deposit(uint256 amount) internal override {
        minichef.deposit(pid, amount, address(this));
    }

    function _withdraw(uint256 amount) internal override {
        minichef.withdraw(pid, amount, address(this));


    }

    function _claimRewards() internal override {
        minichef.harvest(pid, address(this));
    }

    function _userInfo() internal view virtual override returns (uint256 amount, uint256 rewardDebt) {
        return minichef.userInfo(pid, address(this));
    }

    function _emergencyWithdraw() internal override {
        minichef.emergencyWithdraw(pid, address(this));
    }
}
