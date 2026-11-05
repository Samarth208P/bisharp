// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Bisharp} from "../src/Bisharp.sol";
import {TestToken} from "../src/TestToken.sol";
import {MockFeed, Vm} from "./Bisharp.t.sol";

contract AdversarialToken is TestToken {
    bool public taxed;
    bool public blocked;
    address public callbackTarget;
    bool public callbackBlocked;
    constructor(uint8 d) TestToken("Adversarial test token", "TEST", d) {}
    function configure(bool tax, bool blockTransfers, address target) external {
        taxed = tax; blocked = blockTransfers; callbackTarget = target;
    }
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            require(!blocked, "Token frozen");
            if (callbackTarget != address(0)) {
                (bool ok, bytes memory reason) = callbackTarget.call(abi.encodeCall(Bisharp.cancelOrder, (1)));
                require(!ok && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "Reentry must hit guard");
                callbackBlocked = true;
            }
            if (taxed) {
                uint256 fee = amount / 10;
                super._update(from, address(0), fee);
                amount -= fee;
            }
        }
        super._update(from, to, amount);
    }
}

contract AdversarialTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    AdversarialToken usd;
    AdversarialToken eth;
    Bisharp escrow;
    address constant RECIPIENT = address(0xCAFE);
    function setUp() public {
        vm.warp(1_000_000);
        usd = new AdversarialToken(6);
        eth = new AdversarialToken(18);
        escrow = new Bisharp(address(usd), address(eth), address(new MockFeed()), 3600);
        usd.faucet(); eth.faucet();
        usd.approve(address(escrow), type(uint256).max);
        eth.approve(address(escrow), type(uint256).max);
    }
    function create() internal returns (uint256) {
        return escrow.createOrder(100e6, 0.05 ether, 2100e18, uint64(block.timestamp + 1 hours), RECIPIENT);
    }
    function testTaxedPrincipalRejectedAtomically() public {
        usd.configure(true, false, address(0));
        vm.expectRevert(Bisharp.UnsupportedToken.selector);
        create();
        require(escrow.orderCount() == 0 && escrow.totalLiability() == 0, "no order or liability");
        require(usd.balanceOf(address(this)) == 1000e6, "principal rolled back");
    }
    function testTaxedOutputRejectedAtomically() public {
        uint256 id = create();
        eth.configure(true, false, address(0));
        vm.expectRevert(Bisharp.UnsupportedToken.selector);
        escrow.fillOrder(id);
        require(escrow.getOrder(id).status == Bisharp.Status.Open, "still open");
        require(eth.balanceOf(RECIPIENT) == 0 && escrow.credits(address(this)) == 0, "no output or credit");
    }
    function testFrozenClaimRetainsOwnershipAndLiability() public {
        uint256 id = create();
        escrow.cancelOrder(id);
        usd.configure(false, true, address(0));
        vm.expectRevert();
        escrow.claim(address(this));
        require(escrow.credits(address(this)) == 100e6 && escrow.totalLiability() == 100e6, "credit and liability retained");
        usd.configure(false, false, address(0));
        escrow.claim(address(this));
        require(usd.balanceOf(address(this)) == 1000e6 && escrow.totalLiability() == 0, "recovery succeeds");
    }
    function testTokenCallbackCannotReenterFill() public {
        uint256 id = create();
        eth.configure(false, false, address(escrow));
        escrow.fillOrder(id);
        require(eth.callbackBlocked(), "callback rejected by guard");
        require(escrow.credits(address(this)) == 100e6, "one solver credit");
        require(eth.balanceOf(RECIPIENT) == 0.05 ether, "delivered");
    }
}
