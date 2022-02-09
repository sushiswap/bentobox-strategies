// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.11;

import "../BaseStrategy.sol";
import "yearn-protocol/contracts/BaseWrapper.sol";

contract YearnStrategy is BaseWrapper, BaseStrategy {

    // BaseStrategy initializes a immutable storage variable 'strategyToken' we can use

    constructor(
        address yearnRegistry,
        BaseStrategy.ConstructorParams memory baseStrategyParams
    )
        BaseStrategy(baseStrategyParams)
        BaseWrapper(baseStrategyParams.strategyToken, yearnRegistry)
    {}

    function _skim(uint256 amount) internal override {
        _deposit(address(this), address(this), amount, false);
    }

    function _harvest(uint256 investedAmount) internal override returns (int256 amountAdded) {
        amountAdded = int256(super.totalVaultBalance(address(this))) - int256(investedAmount);
        if (amountAdded > 0) {
            _withdraw(uint256(amountAdded));
        }
    }

    function _harvestRewards() internal override {
        // skip as we expect no rewards
    }

    function _withdraw(uint256 amount) internal override {
        _withdraw(address(this), address(this), amount, true);
    }

    function _exit() internal override {
        _withdraw(WITHDRAW_EVERYTHING);
    }

    function migrate(uint256 amount, uint256 maxMigrationLoss) external onlyOwner returns (uint256) {
        return _migrate(address(this), amount, maxMigrationLoss);
    }
}
