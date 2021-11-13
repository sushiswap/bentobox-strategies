// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "./AaveStrategy.sol";

interface IStkAave {
    function stakersCooldowns(address staker) external view returns(uint256);
    function cooldown() external;
    function COOLDOWN_SECONDS() external returns(uint256);
    function UNSTAKE_WINDOW() external returns(uint256);
    function redeem(address to, uint256 amount) external;
    function claimRewards(address to, uint256 amount) external;
}

contract AaveStrategyMainnet is AaveStrategy {

    IStkAave private immutable stkAave;
    uint256 private immutable COOLDOWN_SECONDS; // 10 days
    uint256 private immutable UNSTAKE_WINDOW; // 2 days

    constructor(
        IStkAave _stkAave,
        ILendingPool aaveLendingPool,
        IAaveIncentivesController incentiveController,
        BaseStrategy.ConstructorParams memory params
    ) AaveStrategy(aaveLendingPool, incentiveController, params) {
        stkAave = _stkAave;
        COOLDOWN_SECONDS = _stkAave.COOLDOWN_SECONDS();
        UNSTAKE_WINDOW = _stkAave.UNSTAKE_WINDOW();
    }

    function _harvestRewards() internal override {
        if (address(stkAave) == address(0)) return;
        
        address[] memory rewardTokens = new address[](1);
        rewardTokens[0] = address(aToken);

        // We can pass type(uint256).max to receive all of the rewards.
        // We receive stkAAVE tokens.
        incentiveController.claimRewards(rewardTokens, type(uint256).max, address(this));
        
        // Now we try to unstake the stkAAVE tokens.
        uint256 cooldown = stkAave.stakersCooldowns(address(this));

        if (cooldown == 0) {
            
            // We initiate unstaking for the stkAAVE tokens.
            stkAave.cooldown();

        } else if (cooldown + COOLDOWN_SECONDS < block.timestamp) {

            if (block.timestamp < cooldown + COOLDOWN_SECONDS + UNSTAKE_WINDOW) {

                // We claim any AAVE rewards we have from staking AAVE.
                stkAave.claimRewards(address(this), type(uint256).max);
                // We unstake stkAAVE and receive AAVE tokens.
                // Our cooldown timestamp resets to 0.
                stkAave.redeem(address(this), type(uint256).max);

            } else {
            
                // We missed the unstake window - we have to reset the cooldown timestamp.
                stkAave.cooldown();

            }
        }
    }
}
