// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;
import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../libraries/Babylonian.sol";
import "../../interfaces/IStrategy.sol";
import "../../interfaces/ISushiSwap.sol";
import "../../interfaces/IMasterChef.sol";
import "../../interfaces/IDynamicSubLPStrategy.sol";
import "../../interfaces/IBentoBoxMinimal.sol";

/// @notice Dynamic strategy that can have different farming strategy
/// For example, farming on Trader Joe then unwrap the jLP to
/// mint pLP and farm on Pengolin.
contract DynamicLPStrategy is IStrategy, Ownable {
    using SafeTransferLib for ERC20;

    address public immutable strategyToken;
    address public immutable token0;
    address public immutable token1;

    address public immutable bentoBox;

    address public feeCollector;
    uint8 public feePercent;

    uint256 public maxBentoBoxBalance; /// @dev Slippage protection when calling harvest
    mapping(address => bool) public strategyExecutors; /// @dev EOAs that can execute safeHarvest

    IDynamicSubLPStrategy[] public subStrategies;
    IDynamicSubLPStrategy public currentSubStrategy;

    bool public exited; /// @dev After bentobox 'exits' the strategy harvest, skim and withdraw functions can no loner be called

    event LogSubStrategyAdded(address indexed subStrategy);
    event LogSubStrategyChanged(
        address indexed fromStrategy,
        address indexed toStrategy,
        uint256 amountOut,
        uint256 amountOutPrice,
        uint256 amountIn,
        uint256 amountInPrice
    );
    event LogSetStrategyExecutor(address indexed executor, bool allowed);

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _strategyExecutor
    ) {
        strategyToken = _strategyToken;
        token0 = ISushiSwap(_strategyToken).token0();
        token1 = ISushiSwap(_strategyToken).token1();

        bentoBox = _bentoBox;

        if (_strategyExecutor != address(0)) {
            strategyExecutors[_strategyExecutor] = true;
            emit LogSetStrategyExecutor(_strategyExecutor, true);
        }
    }

    modifier isActive() {
        require(!exited, "BentoBox Strategy: exited");
        _;
    }

    modifier onlyBentoBox() {
        require(msg.sender == bentoBox, "BentoBox Strategy: only BentoBox");
        _;
    }

    /// @notice Ensure the current strategy is handling _strategyToken token so that skim,
    /// withdraw and exit can report correctly back to bentobox.
    modifier onlyValidStrategy() {
        require(address(currentSubStrategy) != address(0), "zero address");
        require(currentSubStrategy.strategyTokenIn() == strategyToken, "not handling strategyToken");
        _;
    }

    modifier onlyExecutor() {
        require(strategyExecutors[msg.sender], "BentoBox Strategy: only Executors");
        _;
    }

    function addSubStrategy(IDynamicSubLPStrategy subStrategy) public onlyOwner {
        require(address(subStrategy) != address(0), "zero address");
        require(subStrategy.dynamicStrategy() == address(this), "dynamicStrategy mismatch");

        /// @dev make sure the strategy pair token is using the same token0 and token1
        ISushiSwap sushiPair = ISushiSwap(subStrategy.strategyTokenIn());
        require(sushiPair.token0() == token0 && sushiPair.token1() == token1, "incompatible tokens");

        subStrategies.push(subStrategy);
        emit LogSubStrategyAdded(address(subStrategy));

        if (address(currentSubStrategy) == address(0)) {
            require(subStrategy.strategyTokenIn() == strategyToken, "not strategyTokenIn");
            currentSubStrategy = subStrategy;

            emit LogSubStrategyChanged(address(0), address(currentSubStrategy), 0, 0, 0, 0);
        }
    }

    /// @param index the index of the next strategy to use
    /// @param maxSlippageBps maximum tolerated amount of basis points of the total migrated
    ///                   5 = 0.05%
    ///                   10_000 = 100%
    /// @param minDustAmount0 when the new strategy needs to wrap the token0 and token1 from previousSubStrategy
    ///                     unwrapped token0 and token1, after initial addLiquidity, what minimum remaining
    ///                     amount left in the contract (from new pair imbalance),
    ///                     should be considered to swap again for more liquidity. Set to 0 to ignore.
    /// @param minDustAmount1 same as minDustAmount0 but for token1
    function changeStrategy(
        uint256 index,
        uint256 maxSlippageBps,
        uint256 minDustAmount0,
        uint256 minDustAmount1
    ) public onlyExecutor {
        require(index < subStrategies.length, "invalid index");

        IDynamicSubLPStrategy previousSubStrategy = currentSubStrategy;
        currentSubStrategy = subStrategies[index];
        require(previousSubStrategy != currentSubStrategy, "already current");

        /// @dev the next sub strategy is not using the same strategy token
        /// and requires a convertion
        if (previousSubStrategy.strategyTokenIn() != currentSubStrategy.strategyTokenIn()) {
            /// @dev unwrap needs send the token0 and token1 to the next strategy directly
            (uint256 amountFrom, uint256 priceAmountFrom) = previousSubStrategy.withdrawAndUnwrapTo(currentSubStrategy);

            /// @dev wrap from the tokens sent from the previous strategy
            (uint256 amountTo, uint256 priceAmountTo) = currentSubStrategy.wrapAndDeposit(minDustAmount0, minDustAmount1);

            uint256 minToteraledPrice = priceAmountFrom - ((priceAmountFrom * maxSlippageBps) / 10_000);

            require(priceAmountTo >= minToteraledPrice, "maximumBps exceeded");

            emit LogSubStrategyChanged(
                address(previousSubStrategy),
                address(currentSubStrategy),
                amountFrom,
                priceAmountFrom,
                amountTo,
                priceAmountTo
            );
        }
    }

    /// @inheritdoc IStrategy
    function skim(uint256 amount) external override onlyValidStrategy {
        /// @dev bentobox transfers the token in this strategy so we need to
        /// forward them to the sub strategy so that the specific skim can work.
        ERC20(strategyToken).transfer(address(currentSubStrategy), amount);
        currentSubStrategy.skim(amount);
    }

    /// @inheritdoc IStrategy
    function withdraw(uint256 amount) external override isActive onlyBentoBox onlyValidStrategy returns (uint256 actualAmount) {
        return currentSubStrategy.withdraw(amount);
    }

    /// @notice Harvest profits while preventing a sandwich attack exploit.
    /// @param maxBalance The maximum balance of the underlying token that is allowed to be in BentoBox.
    /// @param rebalance Whether BentoBox should rebalance the strategy assets to acheive it's target allocation.
    /// @param maxChangeAmount When rebalancing - the maximum amount that will be deposited to or withdrawn from a strategy to BentoBox.
    /// @dev maxBalance can be set to 0 to keep the previous value.
    /// @dev maxChangeAmount can be set to 0 to allow for full rebalancing.
    function safeHarvest(
        uint256 maxBalance,
        bool rebalance,
        uint256 maxChangeAmount
    ) external onlyExecutor {
        if (maxBalance > 0) {
            maxBentoBoxBalance = maxBalance;
        }

        IBentoBoxMinimal(bentoBox).harvest(strategyToken, rebalance, maxChangeAmount);
    }

    /// @inheritdoc IStrategy
    /// @dev Only BentoBox can call harvest on this strategy.
    /// @dev Ensures that (1) the caller was this contract (called through the safeHarvest function)
    /// and (2) that we are not being frontrun by a large BentoBox deposit when harvesting profits.
    /// @dev Beware that calling harvest can result in a subsequent skim or withdraw call if it's rebalancing.
    function harvest(uint256 balance, address sender) external override isActive onlyBentoBox returns (int256) {
        require(address(currentSubStrategy) != address(0), "zero address");

        /// @dev Don't revert if conditions aren't met in order to allow
        /// BentoBox to continue execution as it might need to do a rebalance.
        if (sender == address(this) && IBentoBoxMinimal(bentoBox).totals(strategyToken).elastic <= maxBentoBoxBalance && balance > 0) {
            return int256(currentSubStrategy.harvest());
        }

        return int256(0);
    }

    /// @inheritdoc IStrategy
    /// @dev do not use isActive modifier here; allow bentobox to call strategy.exit() multiple times
    function exit(uint256 balance) external override onlyBentoBox onlyValidStrategy returns (int256 amountAdded) {
        uint256 actualBalance = currentSubStrategy.exit();

        /// @dev Calculate tokens added (or lost).
        amountAdded = int256(actualBalance) - int256(balance);
        exited = true;
    }

    function swapToLP(uint256 amountOutMin) external onlyExecutor returns (uint256) {
        return currentSubStrategy.swapToLP(amountOutMin, feePercent, feeCollector);
    }

    function setStrategyExecutor(address executor, bool value) external onlyOwner {
        strategyExecutors[executor] = value;
        emit LogSetStrategyExecutor(executor, value);
    }

    function setFeeParameters(address _feeCollector, uint8 _feePercent) external onlyOwner {
        require(feePercent <= 100, "invalid feePercent");
        feeCollector = _feeCollector;
        feePercent = _feePercent;
    }
}
