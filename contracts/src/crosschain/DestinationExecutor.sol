// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CCIPLane} from "./CCIPLane.sol";
import {OrderTypes as O} from "./OrderTypes.sol";

interface Aggregator {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
/// @dev Official v3 SwapRouter ABI (not SwapRouter02).
interface V3Router {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function factory() external view returns (address);
}
interface V3Factory { function getPool(address, address, uint24) external view returns (address); }

contract DestinationExecutor is CCIPLane {
    using SafeERC20 for IERC20;
    IERC20 public immutable inputToken;
    IERC20 public immutable outputToken;
    V3Router public immutable swapRouter;
    address public immutable pool;
    uint24 public immutable poolFee;
    Aggregator public immutable priceFeed;
    Aggregator public immutable sequencerFeed;
    uint32 public immutable maxPriceAge;
    uint32 public immutable sequencerGrace;
    uint256 private immutable priceScale;
    mapping(uint256 => O.Record) private orders;
    event DestinationRegistered(uint256 indexed id, O.State state);
    event OutcomeReady(uint256 indexed id, O.State state, uint256 actualOutput);
    error InvalidPrice();
    error IneligiblePrice();
    error UnsupportedToken();

    struct Config {
        address input; address output; address ccipRouter; uint64 local; uint64 remote;
        address swap; uint24 fee; address feed; uint32 maxAge; address sequencer; uint32 grace;
    }
    constructor(Config memory config) CCIPLane(config.ccipRouter, config.local, config.remote) {
        if (config.input == config.output || config.input.code.length == 0 || config.output.code.length == 0 || config.swap.code.length == 0 || config.feed.code.length == 0 || config.maxAge == 0 || config.maxAge > 1 days) revert InvalidConfiguration();
        inputToken = IERC20(config.input); outputToken = IERC20(config.output);
        swapRouter = V3Router(config.swap); poolFee = config.fee;
        address p = V3Factory(V3Router(config.swap).factory()).getPool(config.input, config.output, config.fee);
        if (p.code.length == 0) revert InvalidConfiguration();
        pool = p;
        priceFeed = Aggregator(config.feed);
        uint8 decimals = Aggregator(config.feed).decimals();
        if (decimals > 18) revert InvalidConfiguration();
        priceScale = 10 ** (18 - decimals);
        maxPriceAge = config.maxAge;
        if (config.sequencer != address(0) && (config.sequencer.code.length == 0 || config.grace == 0)) revert InvalidConfiguration();
        sequencerFeed = Aggregator(config.sequencer); sequencerGrace = config.grace;
    }

    function currentPrice() public view returns (uint256) {
        if (address(sequencerFeed) != address(0)) {
            (, int256 up, uint256 started,,) = sequencerFeed.latestRoundData();
            if (up != 0 || started == 0 || started > block.timestamp || block.timestamp - started <= sequencerGrace) revert InvalidPrice();
        }
        (, int256 answer,, uint256 updated,) = priceFeed.latestRoundData();
        if (answer <= 0 || updated == 0 || updated > block.timestamp || block.timestamp - updated > maxPriceAge) revert InvalidPrice();
        return uint256(answer) * priceScale;
    }

    function getOrder(uint256 id) external view returns (O.Record memory) { return orders[id]; }
    function _receiveEnvelope(O.Envelope memory envelope) internal override {
        if (envelope.kind != O.Kind.Create && envelope.kind != O.Kind.Cancel) revert InvalidMessage();
        if (O.hash(peer, address(this), remoteSelector, localSelector, envelope.id, envelope.terms) != envelope.termsHash) revert InvalidMessage();
        O.Record storage o = orders[envelope.id];
        if (o.state == O.State.Unknown) {
            o.terms = envelope.terms;
            o.termsHash = envelope.termsHash;
            // Cancellation before CREATE creates a permanent tombstone.
            o.state = envelope.kind == O.Kind.Cancel ? O.State.Cancelled : O.State.Open;
        } else {
            if (o.termsHash != envelope.termsHash) revert InvalidMessage();
            if (envelope.kind == O.Kind.Cancel && o.state == O.State.Open) o.state = O.State.Cancelled;
        }
        emit DestinationRegistered(envelope.id, o.state);
        if (o.state == O.State.Cancelled || o.state == O.State.Filled) emit OutcomeReady(envelope.id, o.state, 0);
    }

    function fillOrder(uint256 id) external nonReentrant returns (uint256 output) {
        O.Record storage o = orders[id];
        O.Terms memory t = o.terms;
        if (o.state != O.State.Open || block.timestamp >= t.deadline) revert InvalidState();
        if (msg.sender != t.solver) revert Unauthorized();
        if (currentPrice() > t.maxPrice) revert IneligiblePrice();
        o.state = O.State.Filled;
        uint256 balance = inputToken.balanceOf(address(this));
        inputToken.safeTransferFrom(msg.sender, address(this), t.amountIn);
        if (inputToken.balanceOf(address(this)) - balance != t.amountIn) revert UnsupportedToken();
        uint256 beforeOutput = outputToken.balanceOf(t.recipient);
        inputToken.forceApprove(address(swapRouter), t.amountIn);
        output = swapRouter.exactInputSingle(V3Router.ExactInputSingleParams({
            tokenIn: address(inputToken), tokenOut: address(outputToken), fee: poolFee,
            recipient: t.recipient, deadline: t.deadline, amountIn: t.amountIn,
            amountOutMinimum: t.minOutput, sqrtPriceLimitX96: 0
        }));
        inputToken.forceApprove(address(swapRouter), 0);
        uint256 delivered = outputToken.balanceOf(t.recipient) - beforeOutput;
        if (delivered < t.minOutput || inputToken.balanceOf(address(this)) != balance) revert UnsupportedToken();
        // Receipt persists even if sending it later is unaffordable or fails.
        emit OutcomeReady(id, O.State.Filled, delivered);
    }

    function expireOrder(uint256 id) external nonReentrant {
        O.Record storage o = orders[id];
        if (o.state != O.State.Open || block.timestamp < o.terms.deadline) revert InvalidState();
        o.state = O.State.Cancelled;
        emit OutcomeReady(id, O.State.Cancelled, 0);
    }

    function _outcome(uint256 id) internal view returns (O.Envelope memory) {
        O.Record storage o = orders[id];
        if (o.state != O.State.Filled && o.state != O.State.Cancelled) revert InvalidState();
        return O.Envelope(O.VERSION, o.state == O.State.Filled ? O.Kind.Filled : O.Kind.Cancelled, id, o.termsHash, o.terms);
    }
    function quoteReceipt(uint256 id, uint32 gasLimit) external view returns (uint256) { return _fee(_outcome(id), gasLimit); }
    function dispatchReceipt(uint256 id, uint32 gasLimit) external payable nonReentrant returns (bytes32) {
        return _send(_outcome(id), gasLimit);
    }
}
