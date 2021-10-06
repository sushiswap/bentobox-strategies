// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "./BaseStrategy.sol";

/*  Example implementation stub to simplify strategy development.
    Please refer to the BaseStrategy contract natspec comments for
    further tips and clarifications. Also see the SushiStrategy and the
    AavePolygonStrategy for reference implementations. */
contract ExampleImplementation is BaseStrategy {
    // BaseStrategy initializes a immutable storage variable 'strategyToken' of type IERC20 we can use

    constructor(
        address investmentContract,
        address strategyToken,
        address bentoBox,
        address strategyExecutor,
        address factory,
        address[] memory allowedSwapPath
    ) BaseStrategy(strategyToken, bentoBox, factory, strategyExecutor, allowedSwapPath) {
        IERC20(strategyToken).approve(investmentContract, type(uint256).max);
    }

    function _skim(uint256 amount) internal override {
        // assume strategyToken.balanceOf(address(this)) >= amount
        // invest the token
    }

    function _harvest(uint256 investedAmount) internal override returns (int256 delta) {
        // calculate the current amount we get if we withdraw the principal (not accounting for any received rewards)
        // if profitable, withdraw the surplus
        // return the difference between invested and current amount
    }

    function _harvestRewards() internal override {
        // implement the logic for claiming rewards and transfering them to address(this)
        // does not need to report the profits
        // skip if we expect no rewards
    }

    function _withdraw(uint256 amount) internal override {
        // withdraw the requested amount of tokens from the investment to address(this)
    }

    function _exit() internal override {
        // see what the available amount of tokens to withdraw is
        // withdraw as much tokens as possible from the investment to address(this)
        // should not revert
    }
}
