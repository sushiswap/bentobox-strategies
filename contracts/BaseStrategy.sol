// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity >=0.8;

import "./interfaces/IStrategy.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IBentoBoxMinimal.sol";
import "./libraries/UniswapV2Library.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Abstrat contract to simplify BentoBox strategy development.
/// @dev Extend the contract and implement _skim, _harvest, _withdraw, _exit and _harvestRewards methods.
/// @dev Ownership should be transfered to the Sushi ops multisig.
abstract contract BaseStrategy is IStrategy, Ownable {

    using SafeERC20 for IERC20;

    /// @dev invested token.
    IERC20 public immutable strategyToken;
    
    /// @dev BentoBox address.
    IBentoBoxMinimal private immutable bentoBox;
    
    /// @dev Legacy Sushiswap AMM factory address.
    address private immutable factory;

    /// @dev Path are for the original sushiswap AMM.
    /// @dev Set variable visibility to private since we don't want the child contract to modify it.
    address[][] private _allowedSwapPaths = new address[][](0);

    /// @dev After bentobox 'exits' the strategy harvest, skim and withdraw functions can no loner be called.
    bool public exited;
    
    /// @dev Slippage protection when calling harvest.
    uint256 public maxBentoBoxBalance;
    
    /// @dev EOAs that can execute safeHarvest.
    mapping(address => bool) public strategyExecutors;

    event LogSetStrategyExecutor(address indexed executor, bool allowed);
    event LogSetAllowedPath(uint256 indexed pathId, bool allowed);

    error StrategyExited();
    error StrategyNotExited();
    error OnlyBentoBox();
    error OnlyExecutor();
    error NoFactory();
    error SlippageProtection();

    struct ConstructorParams {
        IERC20 strategyToken;
        IBentoBoxMinimal bentoBox;
        address strategyExecutor;
        address factory;
        address[] allowedSwapPath;
    }

    /** @param params a ConstructorParam struct whith the following fields:
        strategyToken - Address of the underlying token the strategy invests.
        bentoBox - BentoBox address.
        factory - legacy SushiSwap factory.
        strategyExecutor - an EOA that will execute the safeHarvest function.
        allowedSwapPath - Path the contract can use when swapping a reward token to the strategy token.
        @dev factory can be set to address(0) if we don't expect rewards we would need to swap.
        @dev allowedPaths can be set to [] if we don't expect rewards we would need to swap. */
    constructor(ConstructorParams memory params) {
        
        strategyToken = params.strategyToken;
        bentoBox = params.bentoBox;
        factory = params.factory;
        
        if (params.allowedSwapPath.length != 0) {
            _allowedSwapPaths.push(params.allowedSwapPath);
            emit LogSetAllowedPath(0, true);
        }

        if (params.strategyExecutor != address(0)) {
            strategyExecutors[params.strategyExecutor] = true;
            emit LogSetStrategyExecutor(params.strategyExecutor, true);
        }
    }

    //** Strategy implementation (override the following functions) */

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
        if (exited) {
            revert StrategyExited();
        }
        _;
    }

    modifier onlyBentoBox() {
        if (msg.sender != address(bentoBox)) {
            revert OnlyBentoBox();
        }
        _;
    }

    modifier onlyExecutor() {
        if (!strategyExecutors[msg.sender]) {
            revert OnlyExecutor();
        }
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

        bentoBox.harvest(address(strategyToken), rebalance, maxChangeAmount);
    }

    /** @inheritdoc IStrategy
    @dev Only BentoBox can call harvest on this strategy.
    @dev Ensures that (1) the caller was this contract (called through the safeHarvest function)
        and (2) that we are not being frontrun by a large BentoBox deposit when harvesting profits. */
    function harvest(uint256 balance, address sender) external override isActive onlyBentoBox returns (int256) {
        /** @dev Don't revert if conditions aren't met in order to allow
            BentoBox to continiue execution as it might need to do a rebalance. */

        if (
            sender == address(this) &&
            bentoBox.totals(address(strategyToken)).elastic <= maxBentoBoxBalance &&
            balance > 0
        ) {
            
            int256 amount = _harvest(balance);

            /** @dev Since harvesting of rewards is accounted for seperately we might also have
            some underlying tokens in the contract that the _harvest call doesn't report. 
            E.g. reward tokens that have been sold into the underlying tokens which are now sitting in the contract.
            Meaning the amount returned by the internal _harvest function isn't necessary the final profit/loss amount */

            uint256 contractBalance = strategyToken.balanceOf(address(this));

            if (amount >= 0) { // _harvest reported a profit

                if (contractBalance > 0) {
                    strategyToken.safeTransfer(address(bentoBox), contractBalance);
                }

                return int256(contractBalance);

            } else if (contractBalance > 0) { // _harvest reported a loss but we have some tokens sitting in the contract

                int256 diff = amount + int256(contractBalance);

                if (diff > 0) { // we still made some profit

                    /// @dev send the profit to BentoBox and reinvest the rest
                    strategyToken.safeTransfer(address(bentoBox), uint256(diff));
                    _skim(uint256(-amount));

                } else { // we made a loss but we have some tokens we can reinvest

                    _skim(contractBalance);

                }

                return diff;

            } else { // we made a loss

                return amount;

            }

        }

        return int256(0);
    }

    /// @inheritdoc IStrategy
    function withdraw(uint256 amount) external override isActive onlyBentoBox returns (uint256 actualAmount) {
        _withdraw(amount);
        /// @dev Make sure we send and report the exact same amount of tokens by using balanceOf.
        actualAmount = strategyToken.balanceOf(address(this));
        strategyToken.safeTransfer(address(bentoBox), actualAmount);
    }

    /// @inheritdoc IStrategy
    /// @dev do not use isActive modifier here; allow bentobox to call strategy.exit() multiple times
    function exit(uint256 balance) external override onlyBentoBox returns (int256 amountAdded) {
        _exit();
        /// @dev Check balance of token on the contract.
        uint256 actualBalance = strategyToken.balanceOf(address(this));
        /// @dev Calculate tokens added (or lost).
        amountAdded = int256(actualBalance) - int256(balance);
        /// @dev Transfer all tokens to bentoBox.
        strategyToken.safeTransfer(address(bentoBox), actualBalance);
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
        if (!exited) {
            revert StrategyNotExited();
        }
        (success, ) = to.call{value: value}(data);
    }

    function getAllowedPath(uint256 pathIndex) external view returns(address[] memory path) {
        path = _allowedSwapPaths[pathIndex];
    }

    function setAllowedPath(address[] calldata path) external onlyOwner {
        _allowedSwapPaths.push(path);
        emit LogSetAllowedPath(_allowedSwapPaths.length, true);
    }

    function disallowPath(uint256 pathIndex) external onlyOwner {
        require(pathIndex < _allowedSwapPaths.length, "Out of bounds");
        _allowedSwapPaths[pathIndex] = new address[](0);
        emit LogSetAllowedPath(pathIndex, false);
    }

    /// @notice Swap some tokens in the contract for the underlying and deposits them to address(this)
    /// @param amountOutMin minimum amount of output tokens we should get (slippage protection).
    /// @param pathIndex Index of the predetermined path we will use for the swap.
    function swapExactTokensForUnderlying(uint256 amountOutMin, uint256 pathIndex) public onlyExecutor returns (uint256 amountOut) {

        if (factory == address(0)) {
            revert NoFactory();
        }

        address[] memory path = _allowedSwapPaths[pathIndex];

        uint256 amountIn = IERC20(path[0]).balanceOf(address(this));

        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);

        amountOut = amounts[amounts.length - 1];

        if (amountOut < amountOutMin) {
            revert SlippageProtection();
        }

        IERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(factory, path[0], path[1]), amounts[0]);

        _swap(amounts, path, address(this));
    }

    /// @dev requires the initial amount to have already been sent to the first pair
    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) internal {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address token0 = input < output ? input : output;
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address to = i < path.length - 2 ? UniswapV2Library.pairFor(factory, output, path[i + 2]) : _to;
            IUniswapV2Pair(UniswapV2Library.pairFor(factory, input, output)).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

}
