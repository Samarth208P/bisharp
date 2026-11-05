// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CrossVm, MockTransport} from "./CrossChain.t.sol";
import {AdversarialToken} from "./Adversarial.t.sol";
import {SourceEscrow} from "../src/crosschain/SourceEscrow.sol";
import {OrderTypes as O} from "../src/crosschain/OrderTypes.sol";

contract CrossPayoutTest {
    CrossVm constant vm = CrossVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant USER = address(0xA11CE);
    address constant SOLVER = address(0xB0B);
    address constant destination = address(0xD);
    uint64 constant SOURCE = 1;
    uint64 constant DEST = 2;
    SourceEscrow source;
    MockTransport transport;
    AdversarialToken principalToken;

    function setUp() public {
        vm.warp(1_000_000);
        vm.deal(USER, 1 ether);
        transport = new MockTransport();
        principalToken = new AdversarialToken(6);
        source = new SourceEscrow(address(principalToken), address(transport), SOURCE, DEST, 1000e6, 10000e6);
        // These tests inject receipts from the authenticated peer to isolate
        // source payout behavior; destination round trips have separate tests.
        source.pairPeer(address(destination));
        transport.set(address(source), SOURCE);
        vm.startPrank(USER);
        principalToken.faucet();
        principalToken.approve(address(source), type(uint256).max);
        vm.stopPrank();
    }

    function terms(uint128 amount) internal view returns (O.Terms memory) {
        return O.Terms(USER, USER, SOLVER, uint64(block.timestamp + 1 hours), amount, amount, 1, 2100e18);
    }

    function create() internal returns (uint256) {
        vm.prank(USER);
        return source.createOrder{value: 1e12}(terms(100e6), 400_000);
    }

    function testTaxAfterDepositPreservesRefundAndSolverPayment() public {
        for (uint256 i; i < 2; ++i) {
            uint256 id = create();
            O.Record memory record = source.getOrder(id);
            O.Kind kind = i == 0 ? O.Kind.Cancelled : O.Kind.Filled;
            address beneficiary = i == 0 ? USER : SOLVER;
            transport.inject(
                address(source), address(destination), DEST,
                O.Envelope(O.VERSION, kind, id, record.termsHash, record.terms), bytes32(id)
            );
            principalToken.configure(true, false, address(0));
            uint256 beforeBalance = principalToken.balanceOf(beneficiary);
            vm.expectRevert(SourceEscrow.UnsupportedToken.selector);
            source.claim(id);
            require(!source.getOrder(id).claimed, "claim remains retryable");
            require(source.credits(beneficiary) == 100e6 && source.totalLiability() == 100e6, "credit retained");
            require(principalToken.balanceOf(beneficiary) == beforeBalance, "no partial payment");
            principalToken.configure(false, false, address(0));
            source.claim(id);
            require(principalToken.balanceOf(beneficiary) == beforeBalance + 100e6, "exact recovered payment");
            require(source.totalLiability() == 0, "settled");
        }
    }

    function testEscrowCannotBeSolver() public {
        O.Terms memory t = terms(100e6);
        t.solver = address(source);
        vm.prank(USER);
        vm.expectRevert(SourceEscrow.InvalidTerms.selector);
        source.createOrder{value: 1e12}(t, 400_000);
        require(source.orderCount() == 0 && source.totalLiability() == 0, "no stranded principal");
    }

    function testSenderSurchargeCannotSpendAnotherOrdersPrincipal() public {
        uint256 id = create();
        create();
        O.Record memory record = source.getOrder(id);
        transport.inject(
            address(source), destination, DEST,
            O.Envelope(O.VERSION, O.Kind.Cancelled, id, record.termsHash, record.terms), bytes32(id)
        );
        principalToken.setSurcharge(true);
        vm.expectRevert(SourceEscrow.UnsupportedToken.selector);
        source.claim(id);
        require(principalToken.balanceOf(address(source)) == 200e6, "both orders funded");
        require(source.totalLiability() == 200e6 && !source.getOrder(id).claimed, "liabilities retained");
        principalToken.setSurcharge(false);
        source.claim(id);
        require(principalToken.balanceOf(address(source)) == 100e6, "other order remains fully funded");
    }
}
