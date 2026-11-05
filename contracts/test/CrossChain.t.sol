// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SourceEscrow} from "../src/crosschain/SourceEscrow.sol";
import {DestinationExecutor, V3Router} from "../src/crosschain/DestinationExecutor.sol";
import {CCIPLane} from "../src/crosschain/CCIPLane.sol";
import {OrderTypes as O} from "../src/crosschain/OrderTypes.sol";
import {Client} from "@ccip/libraries/Client.sol";
import {CCIPReceiver} from "@ccip/applications/CCIPReceiver.sol";
import {TestToken} from "../src/TestToken.sol";
import {MockFeed, Vm} from "./Bisharp.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface CrossVm is Vm {
    function deal(address, uint256) external;
    function getCode(string calldata) external returns (bytes memory);
    function mockCall(address, bytes calldata, bytes calldata) external;
    function clearMockedCalls() external;
}

/// @dev Adversarial transport scheduler, NOT a replacement for real CCIP evidence.
contract MockTransport {
    struct Queued { address target; bytes payload; }
    Queued[] private queue;
    mapping(address => uint64) public selectors;
    uint256 public fee = 1e12;
    bool public broken;
    function set(address endpoint, uint64 selector) external { selectors[endpoint] = selector; }
    function setFee(uint256 f, bool b) external { fee = f; broken = b; }
    function isChainSupported(uint64) external pure returns (bool) { return true; }
    function getFee(uint64, Client.EVM2AnyMessage calldata) external view returns (uint256) { require(!broken, "lane down"); return fee; }
    function ccipSend(uint64, Client.EVM2AnyMessage calldata message) external payable returns (bytes32 id) {
        require(!broken && msg.value == fee, "fee");
        id = keccak256(abi.encode(address(this), queue.length));
        queue.push(Queued(abi.decode(message.receiver, (address)), abi.encode(Client.Any2EVMMessage(id, selectors[msg.sender], abi.encode(msg.sender), message.data, new Client.EVMTokenAmount[](0)))));
    }
    function count() external view returns (uint256) { return queue.length; }
    function deliver(uint256 index) external {
        Queued memory q = queue[index];
        CCIPReceiver(q.target).ccipReceive(abi.decode(q.payload, (Client.Any2EVMMessage)));
    }
    function inject(address target, address sender, uint64 selector, O.Envelope calldata envelope, bytes32 id) external {
        CCIPReceiver(target).ccipReceive(Client.Any2EVMMessage(id, selector, abi.encode(sender), abi.encode(envelope), new Client.EVMTokenAmount[](0)));
    }
}

contract MockSwap {
    address public immutable pool = address(new TestToken("Pool marker", "P", 18));
    bool public broken;
    uint256 public output = 0.05 ether;
    function factory() external view returns (address) { return address(this); }
    function getPool(address, address, uint24) external view returns (address) { return pool; }
    function set(bool b, uint256 amount) external { broken = b; output = amount; }
    function exactInputSingle(V3Router.ExactInputSingleParams calldata p) external payable returns (uint256) {
        require(!broken && output >= p.amountOutMinimum && block.timestamp <= p.deadline, "swap failed");
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        TestToken(p.tokenOut).faucet();
        IERC20(p.tokenOut).transfer(p.recipient, output);
        return output;
    }
}

contract UptimeFeed {
    int256 public down;
    uint256 public started;
    function set(int256 down_, uint256 started_) external { down = down_; started = started_; }
    function decimals() external pure returns (uint8) { return 0; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return (1, down, started, block.timestamp, 1); }
}

contract CrossChainTest {
    CrossVm internal constant vm = CrossVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SourceEscrow source;
    DestinationExecutor destination;
    TestToken usd;
    TestToken destUsd;
    TestToken eth;
    MockFeed feed;
    MockTransport transport;
    MockSwap swap;
    uint64 constant SOURCE = 16015286601757825753;
    uint64 constant DEST = 5224473277236331295;
    address constant USER = address(0xA11CE);
    address constant SOLVER = address(0xB0B);
    address constant RECIPIENT = address(0xCAFE);
    function setUp() public virtual {
        vm.warp(1_000_000);
        vm.deal(USER, 100 ether); vm.deal(SOLVER, 100 ether); vm.deal(address(this), 100 ether);
        usd = new TestToken("Source USD", "bUSD", 6);
        destUsd = new TestToken("Destination USD", "bUSD", 6);
        eth = new TestToken("Output", "bETH", 18);
        transport = new MockTransport(); swap = new MockSwap(); feed = new MockFeed();
        source = new SourceEscrow(address(usd), address(transport), SOURCE, DEST, 1000e6, 10000e6);
        destination = new DestinationExecutor(DestinationExecutor.Config(address(destUsd), address(eth), address(transport), DEST, SOURCE, address(swap), 3000, address(feed), 3600, address(0), 0));
        source.pairPeer(address(destination)); destination.pairPeer(address(source));
        transport.set(address(source), SOURCE); transport.set(address(destination), DEST);
        vm.startPrank(USER); usd.faucet(); usd.approve(address(source), type(uint256).max); vm.stopPrank();
        vm.startPrank(SOLVER); destUsd.faucet(); destUsd.approve(address(destination), type(uint256).max); vm.stopPrank();
    }
    function terms(uint128 principal) internal view returns (O.Terms memory) {
        return O.Terms(USER, RECIPIENT, SOLVER, uint64(block.timestamp + 1 hours), principal, 100e6, 0.04 ether, 2100e18);
    }
    function create() internal returns (uint256) {
        vm.prank(USER);
        return source.createOrder{value: 1e12}(terms(100e6), 400_000);
    }
    function cancel(uint256 id) internal { vm.prank(USER); source.requestCancel{value: 1e12}(id, 400_000); }
    function fill(uint256 id) internal { vm.prank(SOLVER); destination.fillOrder(id); }
    function dispatch(uint256 id) internal { destination.dispatchReceipt{value: 1e12}(id, 300_000); }

    function testRoundTripFillAndClaim() public {
        uint256 id = create(); transport.deliver(0); fill(id);
        require(source.credits(SOLVER) == 0 && usd.balanceOf(address(source)) == 100e6, "no unauthenticated payout");
        require(eth.balanceOf(RECIPIENT) == 0.05 ether, "actual delivery");
        dispatch(id); transport.deliver(1);
        require(source.credits(SOLVER) == 100e6, "authenticated credit");
        source.claim(id);
        require(usd.balanceOf(SOLVER) == 100e6 && source.totalLiability() == 0, "solver paid");
        vm.expectRevert(CCIPLane.InvalidState.selector); source.claim(id);
    }
    function testCancellationBeforeCreateKeepsTombstone() public {
        uint256 id = create(); cancel(id); transport.deliver(1); transport.deliver(0);
        require(destination.getOrder(id).state == O.State.Cancelled, "cannot resurrect");
        vm.prank(SOLVER); vm.expectRevert(CCIPLane.InvalidState.selector); destination.fillOrder(id);
        dispatch(id); transport.deliver(2); source.claim(id);
        require(usd.balanceOf(USER) == 1000e6, "principal refunded");
    }
    function testFillWinsCancellationAndDelayedReceipt() public {
        uint256 id = create(); transport.deliver(0); fill(id); cancel(id);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(CCIPLane.InvalidState.selector); source.claim(id);
        transport.deliver(1); dispatch(id); transport.deliver(2); source.claim(id);
        require(source.credits(USER) == 0 && usd.balanceOf(SOLVER) == 100e6, "no timeout refund");
    }
    function testDuplicateTransportAndLogicalReceipts() public {
        uint256 id = create(); transport.deliver(0); fill(id); dispatch(id);
        transport.deliver(1); transport.deliver(1);
        source.claim(id);
        dispatch(id); transport.deliver(2);
        require(usd.balanceOf(SOLVER) == 100e6 && source.credits(SOLVER) == 0 && source.totalLiability() == 0, "one allocation across distinct receipts");
    }
    function testSendFailureCannotUndoFill() public {
        uint256 id = create(); transport.deliver(0); fill(id);
        transport.setFee(1e12, true);
        vm.expectRevert(); destination.dispatchReceipt{value: 1e12}(id, 300_000);
        require(destination.getOrder(id).state == O.State.Filled && eth.balanceOf(RECIPIENT) == 0.05 ether, "outcome persists");
        transport.setFee(1e12, false); dispatch(id); transport.deliver(1);
        require(source.credits(SOLVER) == 100e6, "retry succeeds");
    }
    function testFeeExhaustionUsesNoPrincipal() public {
        uint256 id = create();
        vm.prank(USER); vm.expectRevert(); source.requestCancel(id, 400_000);
        require(source.getOrder(id).state == O.State.Open && usd.balanceOf(address(source)) == 100e6, "principal intact");
    }
    function testSwapFailureAndStaleFeedAreRecoverable() public {
        uint256 id = create(); transport.deliver(0);
        swap.set(true, 0.05 ether);
        vm.prank(SOLVER); vm.expectRevert(); destination.fillOrder(id);
        require(destination.getOrder(id).state == O.State.Open && destUsd.balanceOf(SOLVER) == 1000e6, "atomic attempt");
        swap.set(false, 0.05 ether); feed.set(2000e8, block.timestamp - 3601);
        vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.InvalidPrice.selector); destination.fillOrder(id);
        cancel(id); transport.deliver(1); dispatch(id); transport.deliver(2); source.claim(id);
    }
    function testExpiryBoundaryClosesOnlyOnDestination() public {
        uint256 id = create(); transport.deliver(0);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(SOLVER); vm.expectRevert(CCIPLane.InvalidState.selector); destination.fillOrder(id);
        vm.expectRevert(CCIPLane.InvalidState.selector); source.claim(id);
        destination.expireOrder(id); dispatch(id); transport.deliver(1); source.claim(id);
        require(usd.balanceOf(USER) == 1000e6, "confirmed refund");
    }
    function testRejectSpoofedRouterSenderAndDomain() public {
        uint256 id = create(); O.Record memory o = source.getOrder(id);
        O.Envelope memory e = O.Envelope(1, O.Kind.Create, id, o.termsHash, o.terms);
        vm.expectRevert(CCIPLane.InvalidMessage.selector); transport.inject(address(destination), address(this), SOURCE, e, bytes32(uint256(1)));
        vm.expectRevert(CCIPLane.InvalidMessage.selector); transport.inject(address(destination), address(source), DEST, e, bytes32(uint256(2)));
        e.terms.recipient = address(this);
        vm.expectRevert(CCIPLane.InvalidMessage.selector); transport.inject(address(destination), address(source), SOURCE, e, bytes32(uint256(3)));
        vm.expectRevert(); destination.ccipReceive(Client.Any2EVMMessage(bytes32(0), SOURCE, abi.encode(address(source)), abi.encode(e), new Client.EVMTokenAmount[](0)));
    }
    function testConflictingReceiptRejectedAndPairImmutable() public {
        uint256 id = create(); transport.deliver(0); fill(id); dispatch(id); transport.deliver(1);
        O.Record memory o = source.getOrder(id);
        O.Envelope memory e = O.Envelope(1, O.Kind.Cancelled, id, o.termsHash, o.terms);
        vm.expectRevert(SourceEscrow.ConflictingOutcome.selector); transport.inject(address(source), address(destination), DEST, e, bytes32(uint256(50)));
        vm.expectRevert(CCIPLane.Unauthorized.selector); source.pairPeer(address(this));
        require(source.credits(SOLVER) == 100e6 && source.credits(USER) == 0, "original outcome intact");
    }
    function testNativeFeeCreditSeparated() public {
        vm.prank(USER); source.createOrder{value: 2e12}(terms(100e6), 400_000);
        require(source.nativeCredits(USER) == 1e12 && source.totalLiability() == 100e6, "separate ledgers");
        source.claimNative(payable(USER));
        require(address(source).balance == 0 && usd.balanceOf(address(source)) == 100e6, "only fees withdrawn");
    }
    function testFrozenBeneficiaryClaimRetainsCredit() public {
        uint256 id = create(); transport.deliver(0); fill(id); dispatch(id); transport.deliver(1);
        vm.mockCall(address(usd), abi.encodeWithSelector(usd.transfer.selector, SOLVER, 100e6), abi.encode(false));
        vm.expectRevert(); source.claim(id);
        require(!source.getOrder(id).claimed && source.credits(SOLVER) == 100e6 && source.totalLiability() == 100e6, "claim rollback preserves creditor");
        vm.clearMockedCalls(); source.claim(id);
        require(usd.balanceOf(SOLVER) == 100e6, "claim recovers");
    }
    function testUnauthorizedSolverCannotSpendApprovedFunding() public {
        uint256 id = create(); transport.deliver(0);
        vm.prank(USER); vm.expectRevert(CCIPLane.Unauthorized.selector); destination.fillOrder(id);
        require(destUsd.balanceOf(SOLVER) == 1000e6, "solver funding untouched");
    }
    function testDestinationRejectsInvalidOracleAnswers() public {
        uint256 id = create(); transport.deliver(0);
        feed.set(0, block.timestamp); vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.InvalidPrice.selector); destination.fillOrder(id);
        feed.set(-1, block.timestamp); vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.InvalidPrice.selector); destination.fillOrder(id);
        feed.set(2000e8, 0); vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.InvalidPrice.selector); destination.fillOrder(id);
        feed.set(2000e8, block.timestamp + 1); vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.InvalidPrice.selector); destination.fillOrder(id);
        feed.set(2200e8, block.timestamp); vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.IneligiblePrice.selector); destination.fillOrder(id);
        require(destination.getOrder(id).state == O.State.Open, "invalid oracle never fills");
    }
    function testSequencerOutageAndRecoveryGraceBoundary() public {
        UptimeFeed uptime = new UptimeFeed();
        source = new SourceEscrow(address(usd), address(transport), SOURCE, DEST, 1000e6, 10000e6);
        destination = new DestinationExecutor(DestinationExecutor.Config(address(destUsd), address(eth), address(transport), DEST, SOURCE, address(swap), 3000, address(feed), 3600, address(uptime), 3600));
        source.pairPeer(address(destination)); destination.pairPeer(address(source));
        transport.set(address(source), SOURCE); transport.set(address(destination), DEST);
        vm.prank(USER); usd.approve(address(source), type(uint256).max);
        vm.prank(SOLVER); destUsd.approve(address(destination), type(uint256).max);
        uint256 id = create(); transport.deliver(0);
        uptime.set(1, block.timestamp - 7200);
        vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.InvalidPrice.selector); destination.fillOrder(id);
        uptime.set(0, block.timestamp - 3600);
        vm.prank(SOLVER); vm.expectRevert(DestinationExecutor.InvalidPrice.selector); destination.fillOrder(id);
        uptime.set(0, block.timestamp - 3601); fill(id);
        require(eth.balanceOf(RECIPIENT) == 0.05 ether, "fill resumes after grace");
    }
    function testOrderLimitAndOwnerPagination() public {
        vm.prank(USER); vm.expectRevert(SourceEscrow.InvalidTerms.selector); source.createOrder{value: 1e12}(terms(1000e6 + 1), 400_000);
        vm.prank(USER); usd.faucet();
        for (uint256 i; i < 12; i++) create();
        uint256[] memory ids = source.ownerOrders(USER, 10, 10);
        require(ids.length == 2 && ids[0] == 2 && ids[1] == 1, "older owner orders reachable");
        require(source.ownerOrders(USER, 100, 10).length == 0, "past end is empty");
        vm.expectRevert(SourceEscrow.InvalidTerms.selector); source.ownerOrders(USER, 0, 51);
    }
    function testRouteTotalLiabilityCap() public {
        SourceEscrow capped = new SourceEscrow(address(usd), address(transport), SOURCE, DEST, 100e6, 100e6);
        capped.pairPeer(address(destination));
        vm.startPrank(USER); usd.approve(address(capped), type(uint256).max);
        capped.createOrder{value: 1e12}(terms(100e6), 400_000);
        vm.expectRevert(SourceEscrow.InvalidTerms.selector); capped.createOrder{value: 1e12}(terms(1), 400_000);
        vm.stopPrank();
        require(capped.orderCount() == 1 && capped.totalLiability() == 100e6, "cap enforced before receiving more principal");
    }
    function testFuzzFillCancelRace(uint128 seed, bool fillWins, bool duplicateReceipt) public {
        uint128 principal = seed % 1000e6 + 1;
        vm.prank(USER); uint256 id = source.createOrder{value: 1e12}(terms(principal), 400_000);
        transport.deliver(0);
        if (fillWins) { fill(id); cancel(id); transport.deliver(1); }
        else { cancel(id); transport.deliver(1); vm.prank(SOLVER); vm.expectRevert(CCIPLane.InvalidState.selector); destination.fillOrder(id); }
        dispatch(id); transport.deliver(2);
        if (duplicateReceipt) { transport.deliver(2); dispatch(id); transport.deliver(3); }
        require(source.credits(fillWins ? SOLVER : USER) == principal && source.credits(fillWins ? USER : SOLVER) == 0, "one beneficiary");
        source.claim(id);
        require(source.totalLiability() == 0 && usd.balanceOf(address(source)) == 0, "conservation after race");
        require(eth.balanceOf(RECIPIENT) == (fillWins ? 0.05 ether : 0), "output matches exclusive outcome");
    }
    function testFuzzCancellationScheduling(uint128 raw, bool cancelFirst, bool duplicates) public {
        uint128 principal = raw % 1000e6 + 1;
        vm.prank(USER); uint256 id = source.createOrder{value: 1e12}(terms(principal), 400_000);
        cancel(id);
        transport.deliver(cancelFirst ? 1 : 0); transport.deliver(cancelFirst ? 0 : 1);
        if (duplicates) { transport.deliver(0); transport.deliver(1); }
        dispatch(id); transport.deliver(2); source.claim(id);
        require(usd.balanceOf(USER) == 1000e6 && source.totalLiability() == 0 && eth.balanceOf(RECIPIENT) == 0, "conservation under reordering");
    }
}
