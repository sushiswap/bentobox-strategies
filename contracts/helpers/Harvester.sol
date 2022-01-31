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

    function swapExactTokens(address tokenIn, uint256 amountOutMin) external;
    function strategyToken() external view returns(address);
}

// 🚜🚜🚜
contract CombineHarvester is Ownable {

    IBentoBoxMinimal immutable public bentoBox;

    struct ExecuteDataManual {
        ISafeStrategy strategy;
        uint256 maxBalance;
        uint256 maxChangeAmount; // can be set to 0 to allow for full withdrawals / deposits from / to strategy
        address swapToken;
        uint256 minOutAmount;
        bool rebalance;
        bool harvestReward;
    }

    struct ExecuteData {
        ISafeStrategy strategy;
        uint256 maxChangeAmount; // can be set to 0 to allow for full withdrawals / deposits from / to strategy
        address swapToken;
        uint256 minOutAmount;
        bool harvestReward;
    }

    constructor(address _bentoBox) {
        bentoBox = IBentoBoxMinimal(_bentoBox);
    }

    function executeSafeHarvestsManual(ExecuteDataManual[] calldata datas) external onlyOwner {
        
        uint256 n = datas.length;
        
        for (uint256 i = 0; i < n; i = increment(i)) {

            ExecuteDataManual memory data = datas[i];

            data.strategy.safeHarvest(data.maxBalance, data.rebalance, data.maxChangeAmount, data.harvestReward);

            if (data.swapToken != address(0)) {
                data.strategy.swapExactTokens(data.swapToken, data.minOutAmount);
            }
        }
    }

    function executeSafeHarvests(ExecuteData[] calldata datas) external onlyOwner {

        uint256 n = datas.length;

        for (uint256 i = 0; i < n; i = increment(i)) {

            ExecuteData memory data = datas[i];

            data.strategy.safeHarvest(0, _rebalanceNecessairy(data.strategy), data.maxChangeAmount, data.harvestReward);

            if (data.swapToken != address(0)) {
                data.strategy.swapExactTokens(data.swapToken, data.minOutAmount);
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

    function increment(uint256 i) internal pure returns(uint256) {
        unchecked {
            return i + 1;
        }
    }
}