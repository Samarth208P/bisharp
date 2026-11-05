// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SourceEscrow} from "../src/crosschain/SourceEscrow.sol";
import {DestinationExecutor, Aggregator, V3Router} from "../src/crosschain/DestinationExecutor.sol";
import {TestToken} from "../src/TestToken.sol";
import {IRouterClient} from "@ccip/interfaces/IRouterClient.sol";

interface CrossDeployVm {
    function envUint(string calldata) external returns (uint256);
    function envAddress(string calldata) external returns (address);
    function addr(uint256) external returns (address);
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
    function getCode(string calldata) external returns (bytes memory);
    function writeJson(string calldata, string calldata) external;
    function toString(address) external pure returns (string memory);
}
interface NFTManager {
    struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }
    function createAndInitializePoolIfNecessary(address, address, uint24, uint160) external payable returns (address);
    function mint(MintParams calldata) external payable returns (uint256, uint128, uint256, uint256);
    function factory() external view returns (address);
}
interface WETH { function deposit() external payable; function approve(address, uint256) external returns (bool); }

/// @notice Explicitly testnet-only, with a capped 0.03 OP Sepolia ETH liquidity seed.
contract DeployCross {
    CrossDeployVm constant vm = CrossDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 constant ETH_SELECTOR = 16015286601757825753;
    uint64 constant OP_SELECTOR = 5224473277236331295;
    address constant ETH_ROUTER = 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;
    address constant OP_ROUTER = 0x114A20A10b43D4115e5aeef7345a1A71d2a60C57;
    address constant WETH_OP = 0x4200000000000000000000000000000000000006;
    address constant FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address constant MANAGER = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;
    address constant FEED = 0x61Ec26aA57019C486B10502285c5A3D4A4750AD7;
    event SourceDeployed(address source, address token);
    event DestinationDeployed(address executor, address token, address router, address pool);

    function deploySource() external {
        require(block.chainid == 11155111 && IRouterClient(ETH_ROUTER).isChainSupported(OP_SELECTOR), "Verify source lane");
        uint256 key = vm.envUint("SEPOLIA_PRIVATE_KEY");
        vm.startBroadcast(key);
        TestToken token = new TestToken("Bisharp Test USD", "bUSD", 6);
        SourceEscrow source = new SourceEscrow(address(token), ETH_ROUTER, ETH_SELECTOR, OP_SELECTOR, 1000e6, 10000e6);
        vm.stopBroadcast();
        vm.writeJson(string.concat('{"chainId":11155111,"escrow":"', vm.toString(address(source)), '","inputToken":"', vm.toString(address(token)), '"}'), "deployments/source.json");
        emit SourceDeployed(address(source), address(token));
    }
    function sqrt(uint256 x) internal pure returns (uint256 z) {
        z = x; uint256 y = x / 2 + 1;
        while (y < z) { z = y; y = (x / y + y) / 2; }
    }
    function deployDestination() external {
        require(block.chainid == 11155420 && IRouterClient(OP_ROUTER).isChainSupported(ETH_SELECTOR), "Verify destination lane");
        require(NFTManager(MANAGER).factory() == FACTORY && WETH_OP.code.length > 0, "Verify Uniswap dependencies");
        (, int256 price,, uint256 updated,) = Aggregator(FEED).latestRoundData();
        require(Aggregator(FEED).decimals() == 8 && price > 0 && updated > 0 && updated <= block.timestamp && block.timestamp - updated <= 3600, "ETH/USD invalid");
        uint256 key = vm.envUint("SEPOLIA_PRIVATE_KEY"); address deployer = vm.addr(key);
        // The original SwapRouter ABI has a deadline; router02's ABI does not.
        bytes memory routerCode = bytes.concat(vm.getCode("vendor/uniswap/SwapRouter.json"), abi.encode(FACTORY, WETH_OP));
        vm.startBroadcast(key);
        TestToken token = new TestToken("Bisharp Destination Test USD", "bUSD", 6);
        address swap;
        assembly ("memory-safe") { swap := create(0, add(routerCode, 32), mload(routerCode)) }
        require(swap != address(0) && V3Router(swap).factory() == FACTORY, "Router deployment failed");
        token.faucet(); WETH(WETH_OP).deposit{value: 0.03 ether}();
        token.approve(MANAGER, 1000e6); WETH(WETH_OP).approve(MANAGER, 0.03 ether);
        bool first = address(token) < WETH_OP;
        uint256 usdPrice = uint256(price) / 100;
        uint160 root = uint160(sqrt(first ? (uint256(1e18) << 192) / usdPrice : (usdPrice << 192) / 1e18));
        address pool = NFTManager(MANAGER).createAndInitializePoolIfNecessary(first ? address(token) : WETH_OP, first ? WETH_OP : address(token), 3000, root);
        uint256 usdMin = (0.03 ether * usdPrice / 1 ether) * 95 / 100;
        uint256 wethMin = 0.03 ether * 95 / 100;
        NFTManager(MANAGER).mint(NFTManager.MintParams(first ? address(token) : WETH_OP, first ? WETH_OP : address(token), 3000, -887220, 887220, first ? 1000e6 : 0.03 ether, first ? 0.03 ether : 1000e6, first ? usdMin : wethMin, first ? wethMin : usdMin, deployer, block.timestamp + 10 minutes));
        token.approve(MANAGER, 0); WETH(WETH_OP).approve(MANAGER, 0);
        // OP Sepolia test route explicitly has no sequencer-uptime signal configured.
        DestinationExecutor executor = new DestinationExecutor(DestinationExecutor.Config(address(token), WETH_OP, OP_ROUTER, OP_SELECTOR, ETH_SELECTOR, swap, 3000, FEED, 3600, address(0), 0));
        vm.stopBroadcast();
        vm.writeJson(string.concat('{"chainId":11155420,"executor":"', vm.toString(address(executor)), '","inputToken":"', vm.toString(address(token)), '","outputToken":"', vm.toString(WETH_OP), '","swapRouter":"', vm.toString(swap), '","factory":"', vm.toString(FACTORY), '","pool":"', vm.toString(pool), '","priceFeed":"', vm.toString(FEED), '","sequencerFeed":null}'), "deployments/destination.json");
        emit DestinationDeployed(address(executor), address(token), swap, pool);
    }
    function pairSource() external {
        require(block.chainid == 11155111, "Source only");
        SourceEscrow source = SourceEscrow(vm.envAddress("CROSS_SOURCE"));
        vm.startBroadcast(vm.envUint("SEPOLIA_PRIVATE_KEY")); source.pairPeer(vm.envAddress("CROSS_DESTINATION")); vm.stopBroadcast();
    }
    function pairDestination() external {
        require(block.chainid == 11155420, "Destination only");
        DestinationExecutor destination = DestinationExecutor(vm.envAddress("CROSS_DESTINATION"));
        vm.startBroadcast(vm.envUint("SEPOLIA_PRIVATE_KEY")); destination.pairPeer(vm.envAddress("CROSS_SOURCE")); vm.stopBroadcast();
    }
}
