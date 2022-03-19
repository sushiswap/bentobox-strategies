// SPDX-License-Identifier: GPL-3.0-or-later
// solhint-disable reason-string, avoid-low-level-calls, const-name-snakecase

pragma solidity 0.8.7;
import "../interfaces/IStrategy.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IBentoBoxMinimal.sol";
import "../libraries/UniswapV2Library.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAnchorRouter {
    function depositStable(uint256 _amount) external;

    function redeemStable(uint256 _amount) external;
}

interface IExchangeRateFeeder {
    function exchangeRateOf(address _token, bool _simulate) external view returns (uint256);
}

abstract contract BaseStrategy is IStrategy, Ownable {
    using SafeERC20 for IERC20;

    address public immutable strategyToken;
    address public immutable bentoBox;
    address public immutable factory;
    address public immutable bridgeToken;

    bool public exited; /// @dev After bentobox 'exits' the strategy harvest, skim and withdraw functions can no loner be called
    uint256 public maxBentoBoxBalance; /// @dev Slippage protection when calling harvest
    mapping(address => bool) public strategyExecutors; /// @dev EOAs that can execute safeHarvest

    event LogConvert(address indexed server, address indexed token0, address indexed token1, uint256 amount0, uint256 amount1);
    event LogSetStrategyExecutor(address indexed executor, bool allowed);

    /** @param _strategyToken Address of the underlying token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _factory SushiSwap factory.
        @param _bridgeToken An intermedieary token for swapping any rewards into the underlying token.
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
        @dev factory and bridgeToken can be address(0) if we don't expect rewards we would need to swap
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _factory,
        address _bridgeToken,
        address _strategyExecutor
    ) {
        strategyToken = _strategyToken;
        bentoBox = _bentoBox;
        factory = _factory;
        bridgeToken = _bridgeToken;

        if (_strategyExecutor != address(0)) {
            strategyExecutors[_strategyExecutor] = true;
            emit LogSetStrategyExecutor(_strategyExecutor, true);
        }
    }

    //** Strategy implementation: override the following functions: */

    /// @notice Invests the underlying asset.
    /// @param amount The amount of tokens to invest.
    /// @dev Assume the contract's balance is greater than the amount
    function _skim(uint256 amount) internal virtual;

    /// @notice Harvest any profits made and transfer them to address(this) or report a loss
    /// @param balance The amount of tokens that have been invested.
    /// @return amountAdded The delta (+profit or -loss) that occured in contrast to `balance`.
    /// @dev amountAdded can be left at 0 when reporting profits (gas savings).
    /// amountAdded should not reflect any rewards or tokens the strategy received.
    /// Calcualte the amount added based on what the current deposit is worth.
    /// (The Base Strategy harvest function accounts for rewards).
    function _harvest(uint256 balance) internal virtual returns (int256 amountAdded);

    /// @dev Withdraw the requested amount of the underlying tokens to address(this).
    /// @param amount The requested amount we want to withdraw.
    function _withdraw(uint256 amount) internal virtual;

    /// @notice Withdraw the maximum available amount of the invested assets to address(this).
    /// @dev This shouldn't revert (use try catch).
    function _exit() internal virtual;

    /// @notice Claim any rewards reward tokens and optionally sell them for the underlying token.
    /// @dev Doesn't need to be implemented if we don't expect any rewards.
    function _harvestRewards() internal virtual {}

    //** End strategy implementation */

    modifier isActive() {
        require(!exited, "BentoBox Strategy: exited");
        _;
    }

    modifier onlyBentoBox() {
        require(msg.sender == bentoBox, "BentoBox Strategy: only BentoBox");
        _;
    }

    modifier onlyExecutor() {
        require(strategyExecutors[msg.sender], "BentoBox Strategy: only Executors");
        _;
    }

    function setStrategyExecutor(address executor, bool value) external onlyOwner {
        strategyExecutors[executor] = value;
        emit LogSetStrategyExecutor(executor, value);
    }

    /// @inheritdoc IStrategy
    function skim(uint256 amount) external override {
        _skim(amount);
    }

    /// @notice Harvest profits while preventing a sandwich attack exploit.
    /// @param maxBalance The maximum balance of the underlying token that is allowed to be in BentoBox.
    /// @param rebalance Whether BentoBox should rebalance the strategy assets to acheive it's target allocation.
    /// @param maxChangeAmount When rebalancing - the maximum amount that will be deposited to or withdrawn from a strategy to BentoBox.
    /// @param harvestRewards If we want to claim any accrued reward tokens
    /// @dev maxBalance can be set to 0 to keep the previous value.
    /// @dev maxChangeAmount can be set to 0 to allow for full rebalancing.
    function safeHarvest(
        uint256 maxBalance,
        bool rebalance,
        uint256 maxChangeAmount,
        bool harvestRewards
    ) external onlyExecutor {
        if (harvestRewards) {
            _harvestRewards();
        }

        if (maxBalance > 0) {
            maxBentoBoxBalance = maxBalance;
        }

        IBentoBoxMinimal(bentoBox).harvest(strategyToken, rebalance, maxChangeAmount);
    }

    /// @inheritdoc IStrategy
    function withdraw(uint256 amount) external override isActive onlyBentoBox returns (uint256 actualAmount) {
        _withdraw(amount);
        /// @dev Make sure we send and report the exact same amount of tokens by using balanceOf.
        actualAmount = IERC20(strategyToken).balanceOf(address(this));
        IERC20(strategyToken).safeTransfer(bentoBox, actualAmount);
    }

    /// @inheritdoc IStrategy
    /// @dev do not use isActive modifier here; allow bentobox to call strategy.exit() multiple times
    function exit(uint256 balance) external override onlyBentoBox returns (int256 amountAdded) {
        _exit();
        /// @dev Check balance of token on the contract.
        uint256 actualBalance = IERC20(strategyToken).balanceOf(address(this));
        /// @dev Calculate tokens added (or lost).
        amountAdded = int256(actualBalance) - int256(balance);
        /// @dev Transfer all tokens to bentoBox.
        IERC20(strategyToken).safeTransfer(bentoBox, actualBalance);
        /// @dev Flag as exited, allowing the owner to manually deal with any amounts available later.
        exited = true;
    }

    /** @dev After exited, the owner can perform ANY call. This is to rescue any funds that didn't
        get released during exit or got earned afterwards due to vesting or airdrops, etc. */
    function afterExit(
        address to,
        uint256 value,
        bytes memory data
    ) public onlyOwner returns (bool success) {
        require(exited, "BentoBox Strategy: not exited");
        (success, ) = to.call{value: value}(data);
    }
}

contract USTStrategyV2 is BaseStrategy {
    using SafeERC20 for IERC20;

    IAnchorRouter public constant router = IAnchorRouter(0xcEF9E167d3f8806771e9bac1d4a0d568c39a9388);
    IExchangeRateFeeder public feeder = IExchangeRateFeeder(0x24a76073Ab9131b25693F3b75dD1ce996fd3116c);
    IERC20 public constant UST = IERC20(0xa47c8bf37f92aBed4A126BDA807A7b7498661acD);
    IERC20 public constant aUST = IERC20(0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab);
    address private constant degenBox = 0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce;
    uint256 public fee; // fees on ust
    address public feeCollector;

    constructor(address strategyExecutor, address _feeCollector) BaseStrategy(address(UST), degenBox, address(0), address(0), strategyExecutor) {
        UST.approve(address(router), type(uint256).max);
        aUST.approve(address(router), type(uint256).max);
        feeCollector = _feeCollector;
        fee = 10;
    }

    function _skim(uint256 amount) internal override {
        router.depositStable(amount);
    }

    /** @inheritdoc IStrategy
    @dev Only BentoBox can call harvest on this strategy.
    @dev Ensures that (1) the caller was this contract (called through the safeHarvest function)
        and (2) that we are not being frontrun by a large BentoBox deposit when harvesting profits. */
    function harvest(uint256 balance, address sender) external override isActive onlyBentoBox returns (int256) {
        /** @dev Don't revert if conditions aren't met in order to allow
            BentoBox to continiue execution as it might need to do a rebalance. */

        if (sender == address(this) && IBentoBoxMinimal(bentoBox).totals(strategyToken).elastic <= maxBentoBoxBalance && balance > 0) {
            int256 amount = _harvest(balance);

            /** @dev Since harvesting of rewards is accounted for seperately we might also have
            some underlying tokens in the contract that the _harvest call doesn't report. 
            E.g. reward tokens that have been sold into the underlying tokens which are now sitting in the contract.
            Meaning the amount returned by the internal _harvest function isn't necessary the final profit/loss amount */
            uint256 contractBalance = IERC20(strategyToken).balanceOf(address(this));

            if (amount >= 0) {
                // _harvest reported a profit
                if (contractBalance >= uint256(amount)) {
                    uint256 feeAmount = (uint256(amount) * fee) / 100;
                    uint256 toTransfer = uint256(amount) - feeAmount;
                    IERC20(strategyToken).safeTransfer(bentoBox, uint256(toTransfer));
                    IERC20(strategyToken).safeTransfer(feeCollector, feeAmount);
                    return (amount);
                } else {
                    uint256 feeAmount = (uint256(contractBalance) * fee) / 100;
                    uint256 toTransfer = uint256(contractBalance) - feeAmount;
                    IERC20(strategyToken).safeTransfer(bentoBox, toTransfer);
                    IERC20(strategyToken).safeTransfer(feeCollector, feeAmount);
                    return int256(contractBalance);
                }
            } else {
                // we made a loss
                return amount;
            }
        }

        return int256(0);
    }

    function _harvest(uint256 balance) internal view override returns (int256) {
        uint256 exchangeRate = feeder.exchangeRateOf(address(UST), true);
        uint256 keep = toAUST(balance, exchangeRate);
        uint256 total = aUST.balanceOf(address(this)) + toAUST(UST.balanceOf(address(this)), exchangeRate);
        return int256(toUST(total, exchangeRate)) - int256(toUST(keep, exchangeRate));
    }

    function _withdraw(uint256 amount) internal override {}

    function redeemEarnings() external onlyExecutor {
        uint256 balanceToKeep = IBentoBoxMinimal(bentoBox).strategyData(address(UST)).balance;
        uint256 exchangeRate = feeder.exchangeRateOf(address(UST), true);
        uint256 liquid = UST.balanceOf(address(this));
        uint256 total = toUST(aUST.balanceOf(address(this)), exchangeRate) + liquid;

        if (total > balanceToKeep) {
            router.redeemStable(toAUST(total - balanceToKeep - liquid, exchangeRate));
        }
    }

    function safeDeposit(uint256 amount) external onlyExecutor {
        _skim(amount);
    }

    function safeWithdraw(uint256 amount) external onlyExecutor {
        uint256 exchangeRate = feeder.exchangeRateOf(address(UST), true);
        uint256 requested = toAUST(amount, exchangeRate);
        router.redeemStable(requested);
    }

    function safeWithdrawFromAUST(uint256 amount) external onlyExecutor {
        router.redeemStable(amount);
    }

    function updateExchangeRateFeeder(IExchangeRateFeeder feeder_) external onlyOwner {
        feeder = feeder_;
    }

    function setFeeCollector(address _feeCollector, uint256 _fee) external onlyOwner {
        require(_fee <= 50, "max fee is 50");
        feeCollector = _feeCollector;
        fee = _fee;
    }

    function _exit() internal override {
        try router.redeemStable(aUST.balanceOf(address(this))) {} catch {}
    }

    function toUST(uint256 amount, uint256 exchangeRate) public pure returns (uint256) {
        return (amount * exchangeRate) / 1e18;
    }

    function toAUST(uint256 amount, uint256 exchangeRate) public pure returns (uint256) {
        return (amount * 1e18) / exchangeRate;
    }
}
