// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "../BaseStrategy.sol";

interface ISushiBar {
    function enter(uint256 _amount) external;
    function leave(uint256 _share) external;
}

contract SushiStrategy is BaseStrategy {
    ISushiBar public immutable sushiBar;

    constructor(
        address _sushiBar,
        BaseStrategy.ConstructorParams memory baseStrategyParams
    ) BaseStrategy(baseStrategyParams) {
        sushiBar = ISushiBar(_sushiBar);
    }

    function _skim(uint256 amount) internal override {
        strategyToken.approve(address(sushiBar), amount);
        sushiBar.enter(amount);
    }

    function _harvest(uint256 balance) internal override returns (int256) {
        uint256 keep = toShare(balance);
        uint256 total = ERC20(address(sushiBar)).balanceOf(address(this));
        if (total > keep) sushiBar.leave(total - keep);
        // xSUSHI can't report a loss so no need to check for keep < total case
        // we can return 0 when reporting profits (BaseContract checks balanceOf)
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        uint256 requested = toShare(amount);
        uint256 actual = ERC20(address(sushiBar)).balanceOf(address(this));
        sushiBar.leave(requested > actual ? actual : requested);
    }

    function _exit() internal override {
        sushiBar.leave(ERC20(address(sushiBar)).balanceOf(address(this)));
    }

    function toShare(uint256 amount) internal view returns (uint256) {
        uint256 totalShares = ERC20(address(sushiBar)).totalSupply();
        uint256 totalSushi = strategyToken.balanceOf(address(sushiBar));
        return amount * totalShares / totalSushi;
    }
}
