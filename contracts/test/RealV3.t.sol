// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SourceEscrow} from "../src/crosschain/SourceEscrow.sol";
import {DestinationExecutor} from "../src/crosschain/DestinationExecutor.sol";
import {OrderTypes as O} from "../src/crosschain/OrderTypes.sol";
import {TestToken} from "../src/TestToken.sol";
import {MockFeed} from "./Bisharp.t.sol";
import {MockTransport, CrossVm} from "./CrossChain.t.sol";

interface PositionManager {
    struct MintParams {
        address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper;
        uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min;
        address recipient; uint256 deadline;
    }
    function createAndInitializePoolIfNecessary(address, address, uint24, uint160) external payable returns (address);
    function mint(MintParams calldata) external payable returns (uint256, uint128, uint256, uint256);
}

/// @notice Real, unmodified official Uniswap pool/factory/router/NFT bytecode; no swap mocks.
contract RealV3Test {
    CrossVm constant vm = CrossVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestToken usd;
    TestToken eth;
    SourceEscrow source;
    DestinationExecutor destination;
    MockTransport transport;
    address constant RECIPIENT = address(0xCAFE);

    function deployArtifact(string memory file, bytes memory args) internal returns (address deployed) {
        bytes memory code = bytes.concat(vm.getCode(file), args);
        assembly ("memory-safe") { deployed := create(0, add(code, 32), mload(code)) }
        require(deployed != address(0), "artifact deployment");
    }
    function sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = x / 2 + 1;
        while (y < z) { z = y; y = (x / y + y) / 2; }
    }
    function setUp() public {
        vm.warp(1_000_000); vm.deal(address(this), 100 ether);
        usd = new TestToken("Test USD", "bUSD", 6);
        eth = new TestToken("Test ETH", "bETH", 18);
        address factory = deployArtifact("vendor/uniswap/UniswapV3Factory.json", "");
        address router = deployArtifact("vendor/uniswap/SwapRouter.json", abi.encode(factory, address(eth)));
        PositionManager manager = PositionManager(deployArtifact("vendor/uniswap/NonfungiblePositionManager.json", abi.encode(factory, address(eth), address(0))));
        usd.faucet(); eth.faucet();
        usd.approve(address(manager), type(uint256).max); eth.approve(address(manager), type(uint256).max);
        bool usdFirst = address(usd) < address(eth);
        address token0 = usdFirst ? address(usd) : address(eth);
        address token1 = usdFirst ? address(eth) : address(usd);
        uint160 price = uint160(sqrt(usdFirst ? (uint256(1e18) << 192) / 2000e6 : (uint256(2000e6) << 192) / 1e18));
        manager.createAndInitializePoolIfNecessary(token0, token1, 3000, price);
        manager.mint(PositionManager.MintParams(token0, token1, 3000, -887220, 887220, usdFirst ? 1000e6 : 1 ether, usdFirst ? 1 ether : 1000e6, 0, 0, address(this), block.timestamp));
        usd.faucet();
        transport = new MockTransport();
        source = new SourceEscrow(address(usd), address(transport), 1, 2, 1000e6, 10000e6);
        destination = new DestinationExecutor(DestinationExecutor.Config(address(usd), address(eth), address(transport), 2, 1, router, 3000, address(new MockFeed()), 3600, address(0), 0));
        source.pairPeer(address(destination)); destination.pairPeer(address(source));
        transport.set(address(source), 1); transport.set(address(destination), 2);
        usd.approve(address(source), type(uint256).max); usd.approve(address(destination), type(uint256).max);
    }
    function runOrder(uint128 amount, uint128 minimum) internal returns (uint256 id) {
        O.Terms memory t = O.Terms(address(this), RECIPIENT, address(this), uint64(block.timestamp + 1 hours), amount, amount, minimum, 2100e18);
        id = source.createOrder{value: 1e12}(t, 400_000);
        transport.deliver(0);
    }
    function testOfficialV3SwapAndRoundTrip() public {
        uint256 id = runOrder(100e6, 0.04 ether);
        destination.fillOrder(id);
        uint256 delivered = eth.balanceOf(RECIPIENT);
        require(delivered >= 0.04 ether, "real minimum output");
        require(usd.allowance(address(destination), address(destination.swapRouter())) == 0, "no residual router allowance");
        destination.dispatchReceipt{value: 1e12}(id, 300_000); transport.deliver(1);
        source.claim(id);
        require(source.totalLiability() == 0 && source.getOrder(id).claimed, "settled source");
    }
    function testOfficialV3SlippageRevertsEntireAttempt() public {
        uint256 id = runOrder(100e6, 1 ether);
        uint256 beforeBalance = usd.balanceOf(address(this));
        vm.expectRevert(); destination.fillOrder(id);
        require(usd.balanceOf(address(this)) == beforeBalance && eth.balanceOf(RECIPIENT) == 0, "funding and pool trade reverted");
        require(destination.getOrder(id).state == O.State.Open, "order retryable");
    }
    function testFuzzOfficialV3OutputAndConservation(uint64 seed) public {
        uint128 amount = uint128(uint256(seed) % 100e6 + 1000);
        uint256 id = runOrder(amount, 1);
        destination.fillOrder(id);
        require(eth.balanceOf(RECIPIENT) > 0, "output delivered");
        require(usd.balanceOf(address(destination)) == 0, "solver input consumed exactly");
        require(source.totalLiability() == amount && usd.balanceOf(address(source)) == amount, "source escrow conserved");
    }
}
