// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CrossChainTest, MockTransport, MockSwap, CrossVm} from "./CrossChain.t.sol";
import {SourceEscrow} from "../src/crosschain/SourceEscrow.sol";
import {DestinationExecutor} from "../src/crosschain/DestinationExecutor.sol";
import {OrderTypes as O} from "../src/crosschain/OrderTypes.sol";
import {TestToken} from "../src/TestToken.sol";
import {MockFeed} from "./Bisharp.t.sol";

contract CrossHandler {
    CrossVm constant vm = CrossVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SourceEscrow public source;
    DestinationExecutor public destination;
    MockTransport public transport;
    TestToken public usd;
    TestToken public destUsd;
    address constant RECIPIENT = address(0xCAFE);

    constructor(SourceEscrow s, DestinationExecutor d, MockTransport r, TestToken u, TestToken v) {
        source = s;
        destination = d;
        transport = r;
        usd = u;
        destUsd = v;
        usd.approve(address(s), type(uint256).max);
        destUsd.approve(address(d), type(uint256).max);
    }

    function create(uint64 seed) external {
        usd.faucet();
        destUsd.faucet();
        O.Terms memory t = O.Terms(
            address(this),
            RECIPIENT,
            address(this),
            uint64(block.timestamp + 1 hours),
            uint128(uint256(seed) % 100e6 + 1),
            100e6,
            0.04 ether,
            2100e18
        );
        try source.createOrder{value: 1e12}(t, 400_000) {} catch {}
    }

    function relay(uint64 seed) external {
        uint256 count = transport.count();
        if (count == 0) return;
        try transport.deliver(uint256(seed) % count) {} catch {}
    }

    function cancel(uint64 seed) external {
        uint256 count = source.orderCount();
        if (count == 0) return;
        try source.requestCancel{value: 1e12}(uint256(seed) % count + 1, 400_000) {} catch {}
    }

    function fill(uint64 seed) external {
        uint256 count = source.orderCount();
        if (count == 0) return;
        try destination.fillOrder(uint256(seed) % count + 1) {} catch {}
    }

    function receipt(uint64 seed) external {
        uint256 count = source.orderCount();
        if (count == 0) return;
        try destination.dispatchReceipt{value: 1e12}(uint256(seed) % count + 1, 300_000) {} catch {}
    }

    function claim(uint64 seed) external {
        uint256 count = source.orderCount();
        if (count == 0) return;
        try source.claim(uint256(seed) % count + 1) {} catch {}
    }

    function advanceTime(uint32 seed) external {
        vm.warp(block.timestamp + uint256(seed) % 7200);
    }

    function refreshPrice() external {
        MockFeed(address(destination.priceFeed())).set(2000e8, block.timestamp);
    }

    function outage(bool broken) external {
        transport.setFee(1e12, broken);
    }

    function resend(uint64 seed) external {
        uint256 count = source.orderCount();
        if (count == 0) return;
        try source.resendCreate{value: 1e12}(uint256(seed) % count + 1, 400_000) {} catch {}
    }

    function expire(uint64 seed) external {
        uint256 count = source.orderCount();
        if (count == 0) return;
        try destination.expireOrder(uint256(seed) % count + 1) {} catch {}
    }

    // Restore transport and drain every pending order after arbitrary scheduling.
    // Reverts are intentional failures here: recovery must actually complete.
    function finish() external {
        transport.setFee(1e12, false);
        for (uint256 i; i < transport.count(); ++i) transport.deliver(i);
        uint256 count = source.orderCount();
        for (uint256 id = 1; id <= count; ++id) {
            O.Record memory d = destination.getOrder(id);
            if (d.state == O.State.Open) {
                if (block.timestamp < d.terms.deadline) vm.warp(d.terms.deadline);
                destination.expireOrder(id);
            }
            destination.dispatchReceipt{value: 1e12}(id, 300_000);
        }
        for (uint256 i; i < transport.count(); ++i) transport.deliver(i);
        for (uint256 id = 1; id <= count; ++id) {
            if (!source.getOrder(id).claimed) source.claim(id);
        }
        require(source.totalLiability() == 0 && source.credits(address(this)) == 0, "all funds recoverable");
    }
}

contract CrossInvariantTest {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }
    CrossVm constant vm = CrossVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SourceEscrow source;
    DestinationExecutor destination;
    TestToken usd;
    TestToken eth;
    CrossHandler handler;
    address[] targets;

    function setUp() public {
        vm.warp(1_000_000);
        usd = new TestToken("Source", "USD", 6);
        TestToken destUsd = new TestToken("Dest", "USD", 6);
        eth = new TestToken("Output", "ETH", 18);
        MockTransport transport = new MockTransport();
        source = new SourceEscrow(address(usd), address(transport), 1, 2, 1000e6, 100000e6);
        destination = new DestinationExecutor(
            DestinationExecutor.Config(
                address(destUsd),
                address(eth),
                address(transport),
                2,
                1,
                address(new MockSwap()),
                3000,
                address(new MockFeed()),
                3600,
                address(0),
                0
            )
        );
        source.pairPeer(address(destination));
        destination.pairPeer(address(source));
        transport.set(address(source), 1);
        transport.set(address(destination), 2);
        handler = new CrossHandler(source, destination, transport, usd, destUsd);
        vm.deal(address(handler), 100 ether);
        targets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return targets;
    }

    function excludeSelectors() external view returns (FuzzSelector[] memory exclusions) {
        exclusions = new FuzzSelector[](1);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = CrossHandler.finish.selector;
        exclusions[0] = FuzzSelector(address(handler), selectors);
    }

    function afterInvariant() public {
        handler.finish();
        invariantSolvencyAndNoPrematureOrDoubleSettlement();
    }

    function testRecoveryAfterTimeAndTransportOutage() public {
        handler.create(100);
        handler.relay(0);
        handler.outage(true);
        handler.advanceTime(7200 - 1);
        handler.cancel(0);
        handler.finish();
        require(source.getOrder(1).claimed, "expired order recovered after outage");
    }

    function invariantSolvencyAndNoPrematureOrDoubleSettlement() public view {
        uint256 liabilities;
        uint256 credit;
        uint256 filled;
        for (uint256 id = 1; id <= source.orderCount(); ++id) {
            O.Record memory s = source.getOrder(id);
            O.Record memory d = destination.getOrder(id);
            if (!s.claimed) liabilities += s.terms.principal;
            if (s.state == O.State.Filled) require(d.state == O.State.Filled, "payment requires destination fill");
            if (s.state == O.State.Cancelled) {
                require(d.state == O.State.Cancelled, "refund requires destination cancellation");
            }
            if (!s.claimed && (s.state == O.State.Filled || s.state == O.State.Cancelled)) credit += s.terms.principal;
            if (d.state == O.State.Filled) filled++;
        }
        require(source.totalLiability() == liabilities, "exact liabilities");
        require(usd.balanceOf(address(source)) >= liabilities, "source solvent");
        require(source.credits(address(handler)) == credit, "one credit allocation");
        require(eth.balanceOf(address(0xCAFE)) == filled * 0.05 ether, "every fill delivered once");
    }
}
