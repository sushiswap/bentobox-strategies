// SPDX-License-Identifier: GPL-v3

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IBentoBoxMinimal.sol";

pragma solidity 0.8.7;

interface ISafeStrategy {
	function safeHarvest(
		uint256 maxBalance,
		bool rebalance,
		uint256 maxChangeAmount,
		bool harvestRewards
	) external;

    function swapExactTokensForUnderlying(uint256 amountOutMin, uint256 pathIndex) external;
    function strategyToken() external view returns(address);
}

// 🚜🚜🚜
contract CombineHarvester is Ownable {

    IBentoBoxMinimal immutable public bentoBox;

    constructor(address _bentoBox) {
        bentoBox = IBentoBoxMinimal(_bentoBox);
    }

    function executeSafeHarvestsManual(
        ISafeStrategy[] calldata strategies,
        uint256[] calldata maxBalances, // strategy sandwich protection
        bool[] calldata rebalances,
        uint256[] calldata maxChangeAmounts, // can be set to 0 to allow for full withdrawals / deposits from / to strategy
        bool[] calldata harvestRewards,
        uint256[] calldata minOutAmounts
    ) external onlyOwner {
        for (uint256 i = 0; i < strategies.length; i++) {

            strategies[i].safeHarvest(maxBalances[i], rebalances[i], maxChangeAmounts[i], harvestRewards[i]);

            if (minOutAmounts[i] != 0) {
                strategies[i].swapExactTokensForUnderlying(minOutAmounts[i], 0);
            }
        }
    }

    function executeSafeHarvests(
        ISafeStrategy[] calldata strategies,
        uint256[] calldata maxChangeAmounts, // can be set to 0 to allow for full withdrawals / deposits from / to strategy
        bool[] calldata harvestRewards,
        uint256[] calldata minOutAmounts
    ) external onlyOwner {
        for (uint256 i = 0; i < strategies.length; i++) {

            strategies[i].safeHarvest(0, _rebalanceNecessairy(strategies[i]), maxChangeAmounts[i], harvestRewards[i]);

            if (minOutAmounts[i] != 0) {
                strategies[i].swapExactTokensForUnderlying(minOutAmounts[i], 0);
            }
        }
    }

    // returns true if strategy balance differs more than -+1% from the strategy target balance
    function _rebalanceNecessairy(ISafeStrategy strategy) public view returns (bool) {
        
        address token = strategy.strategyToken();
        
        IBentoBoxMinimal.StrategyData memory data = bentoBox.strategyData(token);
        
        uint256 targetStrategyBalance = bentoBox.totals(token).elastic * data.targetPercentage / 100; // targetPercentage ∈ [0, 100]

        if (data.balance == 0) return targetStrategyBalance != 0;
        
        uint256 ratio = targetStrategyBalance * 100 / data.balance;
        
        return ratio >= 101 || ratio <= 99;
    }
}