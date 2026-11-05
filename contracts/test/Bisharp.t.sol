// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Bisharp, IPriceFeed} from "../src/Bisharp.sol";
import {TestToken} from "../src/TestToken.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

contract MockFeed is IPriceFeed {
    int256 public answer = 2000e8;
    uint256 public updated;
    constructor() { updated = block.timestamp; }
    function decimals() external pure returns (uint8) { return 8; }
    function set(int256 a, uint256 t) external { answer = a; updated = t; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updated, updated, 1);
    }
}

contract BisharpTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestToken usd;
    TestToken eth;
    MockFeed feed;
    Bisharp escrow;
    address constant USER = address(0xA11CE);
    address constant SOLVER = address(0xB0B);
    address constant RECIPIENT = address(0xCAFE);

    function setUp() public {
        vm.warp(1_000_000);
        usd = new TestToken("Test USD", "bUSD", 6);
        eth = new TestToken("Test Ether", "bETH", 18);
        feed = new MockFeed();
        escrow = new Bisharp(address(usd), address(eth), address(feed), 3600);
        vm.startPrank(USER);
        usd.faucet();
        usd.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(SOLVER);
        eth.faucet();
        eth.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
    }

    function create() internal returns (uint256) {
        vm.prank(USER);
        return escrow.createOrder(100e6, 0.05 ether, 2100e18, uint64(block.timestamp + 1 hours), RECIPIENT);
    }

    function testFillThenClaim() public {
        uint256 id = create();
        vm.prank(SOLVER);
        escrow.fillOrder(id);
        require(eth.balanceOf(RECIPIENT) == 0.05 ether, "recipient output");
        require(escrow.credits(SOLVER) == 100e6, "solver credit");
        require(escrow.totalLiability() == 100e6, "credit remains liability");
        escrow.claim(SOLVER);
        require(usd.balanceOf(SOLVER) == 100e6 && escrow.totalLiability() == 0, "solver paid");
        vm.expectRevert(Bisharp.InvalidState.selector);
        escrow.claim(SOLVER);
        vm.expectRevert(Bisharp.InvalidState.selector);
        escrow.cancelOrder(id);
    }

    function testCancelThenClaim() public {
        uint256 id = create();
        vm.prank(USER);
        escrow.cancelOrder(id);
        require(escrow.credits(USER) == 100e6, "refund allocated");
        vm.prank(SOLVER);
        vm.expectRevert(Bisharp.InvalidState.selector);
        escrow.fillOrder(id);
        escrow.claim(USER);
        require(usd.balanceOf(USER) == 1000e6, "principal returned");
        require(escrow.credits(SOLVER) == 0, "no double allocation");
    }

    function testOnlyOwnerCancelsBeforeExpiry() public {
        uint256 id = create();
        vm.prank(SOLVER);
        vm.expectRevert(Bisharp.Unauthorized.selector);
        escrow.cancelOrder(id);
    }

    function testExpiryBoundary() public {
        uint256 id = create();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(SOLVER);
        vm.expectRevert(Bisharp.InvalidState.selector);
        escrow.fillOrder(id);
        escrow.cancelOrder(id);
        require(escrow.credits(USER) == 100e6, "expired refund");
    }

    function testTriggerAndInvalidOracle() public {
        uint256 id = create();
        feed.set(2200e8, block.timestamp);
        vm.expectRevert(Bisharp.IneligiblePrice.selector);
        escrow.fillOrder(id);
        feed.set(2000e8, block.timestamp - 3601);
        vm.expectRevert(Bisharp.InvalidPrice.selector);
        escrow.fillOrder(id);
        feed.set(0, block.timestamp);
        vm.expectRevert(Bisharp.InvalidPrice.selector);
        escrow.fillOrder(id);
        feed.set(-1, block.timestamp);
        vm.expectRevert(Bisharp.InvalidPrice.selector);
        escrow.fillOrder(id);
        feed.set(2000e8, block.timestamp + 1);
        vm.expectRevert(Bisharp.InvalidPrice.selector);
        escrow.fillOrder(id);
        require(escrow.getOrder(id).status == Bisharp.Status.Open, "failed fill stays open");
        vm.prank(USER);
        escrow.cancelOrder(id); // stale feed does not block recovery
    }

    function testFundingFailureIsAtomic() public {
        uint256 id = create();
        vm.expectRevert();
        escrow.fillOrder(id); // test contract has no output balance/allowance
        require(escrow.getOrder(id).status == Bisharp.Status.Open, "state rollback");
        require(eth.balanceOf(RECIPIENT) == 0 && escrow.credits(address(this)) == 0, "no phantom output/credit");
    }

    function testInvalidTermsAndUnknownOrder() public {
        vm.startPrank(USER);
        vm.expectRevert(Bisharp.InvalidTerms.selector);
        escrow.createOrder(0, 1, 1, uint64(block.timestamp + 1 hours), USER);
        vm.expectRevert(Bisharp.InvalidTerms.selector);
        escrow.createOrder(1, 1, 1, uint64(block.timestamp + 299), USER);
        vm.expectRevert(Bisharp.InvalidTerms.selector);
        escrow.createOrder(1, 1, 1, uint64(block.timestamp + 31 days), USER);
        vm.expectRevert(Bisharp.InvalidTerms.selector);
        escrow.createOrder(1, 1, 1, uint64(block.timestamp + 1 hours), address(0));
        vm.expectRevert(Bisharp.InvalidState.selector);
        escrow.cancelOrder(999);
        vm.stopPrank();
    }

    function testFuzzPrincipalConservation(uint96 seed, bool fill) public {
        uint256 principal = uint256(seed) % 1000e6 + 1;
        vm.prank(USER);
        uint256 id = escrow.createOrder(principal, 1, 2100e18, uint64(block.timestamp + 1 hours), RECIPIENT);
        if (fill) {
            vm.prank(SOLVER);
            escrow.fillOrder(id);
        } else {
            vm.prank(USER);
            escrow.cancelOrder(id);
        }
        require(escrow.credits(USER) + escrow.credits(SOLVER) == principal, "one allocation");
        require(usd.balanceOf(address(escrow)) == escrow.totalLiability(), "solvency before claim");
        escrow.claim(fill ? SOLVER : USER);
        require(usd.balanceOf(address(escrow)) == 0 && escrow.totalLiability() == 0, "liabilities released once");
    }
}

/// @dev Stateful adversarial scheduling: failed calls, duplicate outcomes and claims.
contract Handler {
    Bisharp public immutable escrow;
    TestToken public immutable usd;
    TestToken public immutable eth;
    constructor(Bisharp e, TestToken u, TestToken t) {
        escrow = e; usd = u; eth = t;
        u.approve(address(e), type(uint256).max);
        t.approve(address(e), type(uint256).max);
    }
    function create(uint96 seed) external {
        usd.faucet();
        escrow.createOrder(uint256(seed) % 100e6 + 1, 1e15, 2100e18, uint64(block.timestamp + 1 hours), address(0xCAFE));
    }
    function fill(uint256 seed) external {
        uint256 count = escrow.orderCount();
        if (count == 0) return;
        eth.faucet();
        try escrow.fillOrder(seed % count + 1) {} catch {}
    }
    function cancel(uint256 seed) external {
        uint256 count = escrow.orderCount();
        if (count == 0) return;
        try escrow.cancelOrder(seed % count + 1) {} catch {}
    }
    function claim() external { try escrow.claim(address(this)) {} catch {} }
}

contract BisharpInvariantTest {
    Bisharp escrow;
    TestToken usd;
    TestToken eth;
    Handler handler;
    address[] private targets;
    function setUp() public {
        usd = new TestToken("Test USD", "bUSD", 6);
        eth = new TestToken("Test Ether", "bETH", 18);
        escrow = new Bisharp(address(usd), address(eth), address(new MockFeed()), 3600);
        handler = new Handler(escrow, usd, eth);
        targets.push(address(handler));
    }
    function targetContracts() external view returns (address[] memory) { return targets; }
    function invariantSolvencyAndExactLiabilities() public view {
        uint256 open;
        uint256 delivered;
        for (uint256 id = 1; id <= escrow.orderCount(); ++id) {
            Bisharp.Order memory o = escrow.getOrder(id);
            if (o.status == Bisharp.Status.Open) open += o.principal;
            if (o.status == Bisharp.Status.Filled) delivered += o.minOutput;
        }
        uint256 expected = open + escrow.credits(address(handler));
        require(escrow.totalLiability() == expected, "exact liability ledger");
        require(usd.balanceOf(address(escrow)) >= expected, "escrow solvent");
        require(eth.balanceOf(address(0xCAFE)) == delivered, "all filled output actually delivered");
    }
}
