// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "./interfaces/IStrategy.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IBentoBoxMinimal.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";

/// @title Abstract contract to simplify BentoBox strategy development.
/// @dev Extend the contract and implement _skim, _harvest, _withdraw, _exit and _harvestRewards methods.
/// Ownership should be transfered to the Sushi ops multisig.
abstract contract BaseStrategy is IStrategy, Ownable {

    using SafeTransferLib for ERC20;

    // invested token.
    ERC20 public immutable strategyToken;
    
    // BentoBox address.
    IBentoBoxMinimal private immutable bentoBox;
    
    // Legacy Sushiswap AMM factory address.
    address private immutable factory;

    // Swap paths (bridges) the original sushiswap AMM.
    // Should lead to the underlying token.
    mapping(address => address) public swapPath;

    // After bentobox 'exits' the strategy harvest and withdraw functions can no longer be called.
    bool private _exited;
    
    // Slippage protection when calling harvest.
    uint256 private _maxBentoBoxBalance;

    // Accounts that can execute methods where slippage protection is required.
    mapping(address => bool) public strategyExecutors;

    event LogSetStrategyExecutor(address indexed executor, bool allowed);
    event LogSetSwapPath(address indexed input, address indexed output);

    error StrategyExited();
    error StrategyNotExited();
    error OnlyBentoBox();
    error OnlyExecutor();
    error NoFactory();
    error SlippageProtection();
    error InvalidSwapPath();
    error NoSwapPath();

    struct ConstructorParams {
        address strategyToken;
        address bentoBox;
        address strategyExecutor;
        address factory;
    }

    /** @param params a ConstructorParam struct whith the following fields:
        strategyToken - Address of the underlying token the strategy invests.
        bentoBox - BentoBox address.
        factory - legacy SushiSwap factory.
        strategyExecutor - initial account that will execute the safeHarvest function. */
    constructor(ConstructorParams memory params) {
        strategyToken = ERC20(params.strategyToken);
        bentoBox = IBentoBoxMinimal(params.bentoBox);
        factory = params.factory;
        strategyExecutors[params.strategyExecutor] = true;
        emit LogSetStrategyExecutor(params.strategyExecutor, true);
    }

    //** Strategy implementation (override the following functions) */

    /// @notice Invests the underlying asset.   
    /// @param amount The amount of tokens to invest.
    /// @dev Assume the contract's balance is greater than the amount.
    function _skim(uint256 amount) internal virtual;

    /// @notice Harvest any profits made and transfer them to address(this) or report a loss.
    /// @param balance The amount of tokens that have been invested.
    /// @return amountAdded The delta (+profit or -loss) that occured in contrast to `balance`.
    /// @dev amountAdded can be left at 0 when reporting profits (gas savings).
    /// amountAdded should not reflect any rewards or tokens the strategy received.
    /// Calculate the amount added based on what the current deposit is worth.
    /// (The Base Strategy harvest function accounts for rewards).
    function _harvest(uint256 balance) internal virtual returns (int256 amountAdded);

    /// @dev Withdraw the requested amount of the underlying tokens to address(this).
    /// @param amount The requested amount we want to withdraw.
    function _withdraw(uint256 amount) internal virtual;

    /// @notice Withdraw the maximum available amount of the invested assets to address(this).
    /// @dev This shouldn't revert (use try catch).
    function _exit() internal virtual;

    /// @notice Claim any reward tokens and optionally sell them for the underlying token.
    /// @dev Doesn't need to be implemented if we don't expect any rewards.
    function _harvestRewards() internal virtual {}

    //** End strategy implementation */

    modifier isActive() {
        if (_exited) {
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

    function setSwapPath(address tokenIn, address tokenOut) external onlyOwner {
        if (tokenIn == address(strategyToken)) revert InvalidSwapPath();
        swapPath[tokenIn] = tokenOut;
        emit LogSetSwapPath(tokenIn, tokenOut);
    }

    /// @inheritdoc IStrategy
    function skim(uint256 amount) external override {
        _skim(amount);
    }

    /// @notice Harvest profits while preventing a sandwich attack exploit.
    /// @param maxBalanceInBentoBox The maximum balance of the underlying token that is allowed to be in BentoBox.
    /// @param rebalance Whether BentoBox should rebalance the strategy assets to acheive it's target allocation.
    /// @param maxChangeAmount When rebalancing - the maximum amount that will be deposited to or withdrawn from a strategy to BentoBox.
    /// @param harvestRewards If we want to claim any accrued reward tokens
    /// @dev maxBalance can be set to 0 to keep the previous value.
    /// @dev maxChangeAmount can be set to 0 to allow for full rebalancing.
    function safeHarvest(
        uint256 maxBalanceInBentoBox,
        bool rebalance,
        uint256 maxChangeAmount,
        bool harvestRewards
    ) external onlyExecutor {
        if (harvestRewards) {
            _harvestRewards();
        }

        if (maxBalanceInBentoBox > 0) {
            _maxBentoBoxBalance = maxBalanceInBentoBox;
        }

        bentoBox.harvest(address(strategyToken), rebalance, maxChangeAmount);
    }

    /** @inheritdoc IStrategy
    @dev Only BentoBox can call harvest on this strategy.
    @dev Ensures that (1) the caller was this contract (called through the safeHarvest function)
        and (2) that we are not being frontrun by a large BentoBox deposit when harvesting profits. */
    function harvest(uint256 balance, address sender) external override isActive onlyBentoBox returns (int256) {
        
        /** @dev Don't revert if conditions aren't met in order to allow
            BentoBox to continue execution as it might need to do a rebalance. */
        if (
            sender != address(this) ||
            bentoBox.totals(address(strategyToken)).elastic > _maxBentoBoxBalance || 
            balance == 0
        ) return int256(0);
            
        int256 amount = _harvest(balance);

        /** @dev We might have some underlying tokens in the contract that the _harvest call doesn't report. 
        E.g. reward tokens that have been sold into the underlying tokens which are now sitting in the contract.
        Meaning the amount returned by the internal _harvest function isn't necessary the final profit/loss amount */

        uint256 contractBalance = strategyToken.balanceOf(address(this)); // Reasonably assume this is less than type(int256).max

        if (amount > 0) { // _harvest reported a profit

            strategyToken.safeTransfer(address(bentoBox), contractBalance);

            return int256(contractBalance);

        } else if (contractBalance > 0) { // _harvest reported a loss but we have some tokens sitting in the contract

            int256 diff = amount + int256(contractBalance);

            if (diff > 0) { // We still made some profit.

                // Send the profit to BentoBox and reinvest the rest.
                strategyToken.safeTransfer(address(bentoBox), uint256(diff));
                _skim(contractBalance - uint256(diff));

            } else { // We made a loss but we have some tokens we can reinvest.

                _skim(contractBalance);

            }

            return diff;

        } else { // We made a loss.

            return amount;

        }

    }

    /// @inheritdoc IStrategy
    function withdraw(uint256 amount) external override isActive onlyBentoBox returns (uint256 actualAmount) {
        _withdraw(amount);
        // Make sure we send and report the exact same amount of tokens by using balanceOf.
        actualAmount = strategyToken.balanceOf(address(this));
        strategyToken.safeTransfer(address(bentoBox), actualAmount);
    }

    /// @inheritdoc IStrategy
    /// @dev Do not use isActive modifier here. Allow bentobox to call strategy.exit() multiple times
    /// This is to ensure that the strategy isn't locked if its (accidentally) set twice in a row as a token's strategy in bentobox.
    function exit(uint256 balance) external override onlyBentoBox returns (int256 amountAdded) {
        _exit();
        // Flag as exited, allowing the owner to manually deal with any amounts available later.
        _exited = true;
        // Check balance of token on the contract.
        uint256 actualBalance = strategyToken.balanceOf(address(this));
        // Calculate tokens added (or lost).
        // We reasonably assume actualBalance and balance are less than type(int256).max
        amountAdded = int256(actualBalance) - int256(balance);
        // Transfer all tokens to bentoBox.
        strategyToken.safeTransfer(address(bentoBox), actualBalance);
    }

    /** @dev After exited, the owner can perform ANY call. This is to rescue any funds that didn't
        get released during exit or got earned afterwards due to vesting or airdrops, etc. */
    function afterExit(
        address to,
        uint256 value,
        bytes memory data
    ) external onlyOwner returns (bool success) {
        if (!_exited) {
            revert StrategyNotExited();
        }
        (success, ) = to.call{value: value}(data);
        require(success);
    }

    function exited() public view returns(bool) {
        return _exited;
    }

    function maxBentoBoxBalance() public view returns (uint256) {
        return _maxBentoBoxBalance;
    }

    /// @notice Swap some tokens in the contract.
    /// @param tokenIn Token we are swapping.
    /// @param amountOutMin Minimum amount of output tokens we should get (slippage protection).
    function swapExactTokens(address tokenIn, uint256 amountOutMin) external onlyExecutor {

        address tokenOut = swapPath[tokenIn];

        if (tokenOut == address(0)) revert NoSwapPath();

        uint256 amountIn = ERC20(tokenIn).balanceOf(address(this));

        uint256 amountOut = _swap(tokenIn, tokenOut, amountIn);
        
        if (amountOut < amountOutMin) revert SlippageProtection();
    }

    function _swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 outAmount) {

        address pair = _pairFor(tokenIn, tokenOut);
        ERC20(tokenIn).safeTransfer(pair, amountIn);
        (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(pair).getReserves();
        
        if (tokenIn < tokenOut) {
            outAmount = _getAmountOut(amountIn, reserve0, reserve1);
            IUniswapV2Pair(pair).swap(0, outAmount, address(this), "");
        } else {
            outAmount = _getAmountOut(amountIn, reserve1, reserve0);
            IUniswapV2Pair(pair).swap(outAmount, 0, address(this), "");
        }
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pair = address(uint160(uint256(keccak256(abi.encodePacked(
            hex'ff',
            factory,
            keccak256(abi.encodePacked(token0, token1)),
            hex'e18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303'
        )))));
    }

    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    function increment(uint256 i) internal pure returns (uint256) {
        unchecked {
            return i + 1;
        }
    }

}
