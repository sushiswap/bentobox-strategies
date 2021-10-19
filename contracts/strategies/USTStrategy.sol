// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "../BaseStrategy.sol";

interface IAnchorRouter {
    function depositStable(uint256 _amount) external;
    function redeemStable(uint256 _amount) external;
}

interface IExchangeRateFeeder {
    function exchangeRateOf(
        address _token,
        bool _simulate
    ) external view returns (uint256);
}

contract USTStrategy is BaseStrategy {
    IAnchorRouter public constant router = IAnchorRouter(0xcEF9E167d3f8806771e9bac1d4a0d568c39a9388);
    IExchangeRateFeeder private constant feeder = IExchangeRateFeeder(0xB12B8247bD1749CC271c55Bb93f6BD2B485C94A7);
    IERC20 public constant UST = IERC20(0xa47c8bf37f92aBed4A126BDA807A7b7498661acD);
    IERC20 public constant aUST = IERC20(0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab);
    address private constant degenBox = 0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce;

    constructor(
        address strategyExecutor
    ) BaseStrategy(address(UST), degenBox, address(0), address(0), strategyExecutor) {
        UST.approve(address(router), type(uint256).max);
        aUST.approve(address(router), type(uint256).max);
    }
    
    function _skim(uint256 amount) internal override {
        router.depositStable(amount);
    }

    function _harvest(uint256 balance) internal override returns (int256) {
        uint256 keep = toAUST(balance);
        uint256 total = aUST.balanceOf(address(this));
        if (total > keep) router.redeemStable(total - keep);
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        uint256 requested = toAUST(amount);
        router.redeemStable(requested);
    }

    function _exit() internal override {
        try router.redeemStable(aUST.balanceOf(address(this))) {} catch {}
    }

    function toAUST(uint256 amount) internal view returns (uint256) {
        return amount * 1e18 / feeder.exchangeRateOf(address(UST), true);
    }
}
