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

    function swapExactTokensForUnderlying(uint256 amountOutMin, address inputToken) external;
    function strategyToken() external view returns(address);
}

// 🚜🚜🚜
contract CombineHarvester is Ownable {

    IBentoBoxMinimal immutable public bentoBox;

    constructor(address _bentoBox) {
        bentoBox = IBentoBoxMinimal(_bentoBox);
    }

    function executeSafeHarvests(
        ISafeStrategy[] memory strategies,
        bool[] memory manual,
        uint256[] memory maxBalances,
        bool[] memory rebalances,
        uint256[] memory maxChangeAmounts, // can be set to 0 to allow for full withdrawals / deposits
        bool[] memory harvestRewards,
        uint256[] memory minOutAmounts
    ) external onlyOwner {
        for (uint256 i = 0; i < strategies.length; i++) {
            
            // BentoBox frontrunning deposit protection - likely won't be needed for Polygon since we will be frequently executing.
            uint256 maxBalance = manual[i] ? maxBalances[i] : 0;
            
            // If BentoBox has to rebalance strategy assets to the target percentage.
            bool rebalance = manual[i] ? rebalances[i] : _rebalanceNecessairy(strategies[i]);
            
            strategies[i].safeHarvest(maxBalance, rebalance, maxChangeAmounts[i], harvestRewards[i]);
            
            if (minOutAmounts[i] > 0) {
                // we only expect wmatic rewards for the current aave strategies
                address inputToken = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
                strategies[i].swapExactTokensForUnderlying(minOutAmounts[i], inputToken);
            }
        }
    }

    // returns true if strategy balance differs more than -+3% from the strategy target balance
    function _rebalanceNecessairy(ISafeStrategy strategy) public view returns (bool) {
        
        address token = strategy.strategyToken();
        
        IBentoBoxMinimal.StrategyData memory data = bentoBox.strategyData(token);
        
        uint256 targetStrategyBalance = bentoBox.totals(token).elastic * data.targetPercentage / 100; // targetPercentage ∈ [0, 100]

        if (data.balance == 0) return targetStrategyBalance != 0;
        
        uint256 ratio = targetStrategyBalance * 100 / data.balance;
        
        return ratio >= 103 || ratio <= 97;
    }
}