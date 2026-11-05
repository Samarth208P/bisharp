// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CCIPLane} from "./CCIPLane.sol";
import {OrderTypes as O} from "./OrderTypes.sol";

contract SourceEscrow is CCIPLane {
    using SafeERC20 for IERC20;
    IERC20 public immutable inputToken;
    uint128 public immutable maxPrincipal;
    uint256 public immutable liabilityCap;
    uint256 public totalLiability;
    uint256 public orderCount;
    mapping(uint256 => O.Record) private orders;
    mapping(address => uint256[]) private ownerIds;
    mapping(address => uint256) public credits;
    event OrderCreated(uint256 indexed id, address indexed owner, bytes32 termsHash);
    event OutcomeCredited(uint256 indexed id, O.State state, address indexed beneficiary);
    event PrincipalClaimed(uint256 indexed id, address indexed beneficiary, uint256 amount);
    error InvalidTerms();
    error UnsupportedToken();
    error ConflictingOutcome();

    constructor(address token, address router, uint64 local_, uint64 remote_, uint128 max_, uint256 cap_)
        CCIPLane(router, local_, remote_)
    {
        if (token.code.length == 0 || max_ == 0 || cap_ < max_) revert InvalidConfiguration();
        inputToken = IERC20(token);
        maxPrincipal = max_;
        liabilityCap = cap_;
    }

    function getOrder(uint256 id) external view returns (O.Record memory) {
        return orders[id];
    }

    function ownerOrderCount(address owner) external view returns (uint256) {
        return ownerIds[owner].length;
    }

    function ownerOrders(address owner, uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        if (limit > 50) revert InvalidTerms();
        uint256 length = ownerIds[owner].length;
        uint256 size = offset >= length ? 0 : (length - offset < limit ? length - offset : limit);
        ids = new uint256[](size);
        for (uint256 i; i < size; ++i) {
            ids[i] = ownerIds[owner][length - 1 - offset - i];
        }
    }

    function _envelope(uint256 id, O.Kind kind) internal view returns (O.Envelope memory) {
        O.Record storage o = orders[id];
        return O.Envelope(O.VERSION, kind, id, o.termsHash, o.terms);
    }

    function quoteCreate(O.Terms calldata terms, uint32 gasLimit) external view returns (uint256) {
        uint256 id = orderCount + 1;
        bytes32 hash = O.hash(address(this), peer, localSelector, remoteSelector, id, terms);
        return _fee(O.Envelope(O.VERSION, O.Kind.Create, id, hash, terms), gasLimit);
    }

    function quoteAction(uint256 id, bool cancel, uint32 gasLimit) external view returns (uint256) {
        if (orders[id].state == O.State.Unknown) revert InvalidState();
        return _fee(_envelope(id, cancel ? O.Kind.Cancel : O.Kind.Create), gasLimit);
    }

    function createOrder(O.Terms calldata terms, uint32 gasLimit) external payable nonReentrant returns (uint256 id) {
        if (
            terms.owner != msg.sender || terms.recipient == address(0) || terms.recipient == peer
                || terms.solver == address(0) || terms.solver == address(this) || terms.solver == peer
                || terms.principal == 0 || terms.principal > maxPrincipal
                || terms.amountIn == 0 || terms.minOutput == 0 || terms.maxPrice == 0
                || terms.deadline < block.timestamp + 5 minutes || terms.deadline > block.timestamp + 30 days
                || totalLiability + terms.principal > liabilityCap
        ) revert InvalidTerms();
        uint256 beforeBalance = inputToken.balanceOf(address(this));
        inputToken.safeTransferFrom(msg.sender, address(this), terms.principal);
        if (inputToken.balanceOf(address(this)) - beforeBalance != terms.principal) revert UnsupportedToken();
        id = ++orderCount;
        bytes32 hash = O.hash(address(this), peer, localSelector, remoteSelector, id, terms);
        orders[id] = O.Record(terms, hash, O.State.Open, false);
        ownerIds[msg.sender].push(id);
        totalLiability += terms.principal;
        _send(_envelope(id, O.Kind.Create), gasLimit);
        emit OrderCreated(id, msg.sender, hash);
    }

    /// @notice A request never releases source principal, including after expiry.
    function requestCancel(uint256 id, uint32 gasLimit) external payable nonReentrant {
        O.Record storage o = orders[id];
        if (o.state != O.State.Open && o.state != O.State.CancelRequested) revert InvalidState();
        if (msg.sender != o.terms.owner && block.timestamp < o.terms.deadline) revert Unauthorized();
        o.state = O.State.CancelRequested;
        _send(_envelope(id, O.Kind.Cancel), gasLimit);
    }

    function resendCreate(uint256 id, uint32 gasLimit) external payable nonReentrant {
        O.State state = orders[id].state;
        if (state != O.State.Open && state != O.State.CancelRequested) revert InvalidState();
        _send(_envelope(id, O.Kind.Create), gasLimit);
    }

    function _receiveEnvelope(O.Envelope memory envelope) internal override {
        O.Record storage o = orders[envelope.id];
        // The authenticated receipt commits to the source's already-stored domain and terms.
        // Resending the full immutable Terms would add 256 bytes without adding authority.
        if (o.state == O.State.Unknown || envelope.termsHash != o.termsHash) revert InvalidMessage();
        O.State result;
        if (envelope.kind == O.Kind.Filled) result = O.State.Filled;
        else if (envelope.kind == O.Kind.Cancelled) result = O.State.Cancelled;
        else revert InvalidMessage();
        if (o.state == O.State.Filled || o.state == O.State.Cancelled) {
            if (o.state != result) revert ConflictingOutcome();
            return;
        }
        o.state = result;
        address beneficiary = result == O.State.Filled ? o.terms.solver : o.terms.owner;
        credits[beneficiary] += o.terms.principal;
        emit OutcomeCredited(envelope.id, result, beneficiary);
    }

    /// @notice Permissionless trigger; payment always goes to the immutable beneficiary.
    function claim(uint256 id) external nonReentrant {
        O.Record storage o = orders[id];
        if (o.claimed || (o.state != O.State.Filled && o.state != O.State.Cancelled)) revert InvalidState();
        address beneficiary = o.state == O.State.Filled ? o.terms.solver : o.terms.owner;
        o.claimed = true;
        uint256 amount = o.terms.principal;
        credits[beneficiary] -= amount;
        totalLiability -= amount;
        uint256 escrowBefore = inputToken.balanceOf(address(this));
        uint256 beneficiaryBefore = inputToken.balanceOf(beneficiary);
        inputToken.safeTransfer(beneficiary, amount);
        // A token that starts taxing transfers after deposit must not silently
        // extinguish the beneficiary's credit or consume another order's funds.
        if (
            inputToken.balanceOf(address(this)) + amount != escrowBefore
                || inputToken.balanceOf(beneficiary) != beneficiaryBefore + amount
        ) revert UnsupportedToken();
        emit PrincipalClaimed(id, beneficiary, amount);
    }
}
