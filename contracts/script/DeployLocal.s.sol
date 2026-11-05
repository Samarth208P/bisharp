// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SourceEscrow} from "../src/crosschain/SourceEscrow.sol";
import {DestinationExecutor} from "../src/crosschain/DestinationExecutor.sol";
import {TestToken} from "../src/TestToken.sol";
import {LocalRouter, LocalFeed, LocalWETH} from "../local/LocalRouter.sol";
import {NFTManager} from "./DeployCross.s.sol";

interface LocalVm {
    function startBroadcast(address) external;
    function stopBroadcast() external;
    function getCode(string calldata) external returns (bytes memory);
    function toString(address) external pure returns (string memory);
    function writeJson(string calldata, string calldata) external;
    function envAddress(string calldata) external returns (address);
}
contract DeployLocal {
    LocalVm constant vm = LocalVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant DEV = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    function deploySource() external {
        require(block.chainid == 31337, "Local source only");
        vm.startBroadcast(DEV);
        TestToken token = new TestToken("Local Source Test USD", "bUSD", 6);
        LocalRouter router = new LocalRouter(1);
        SourceEscrow source = new SourceEscrow(address(token), address(router), 1, 2, 1000e6, 10000e6);
        token.faucet();
        vm.stopBroadcast();
        vm.writeJson(string.concat('{"chainId":31337,"escrow":"', vm.toString(address(source)), '","inputToken":"', vm.toString(address(token)), '","router":"', vm.toString(address(router)), '"}'), "deployments/local-source.json");
    }
    function deploy(bytes memory code) internal returns (address deployed) {
        assembly ("memory-safe") { deployed := create(0, add(code, 32), mload(code)) }
        require(deployed != address(0), "Artifact deployment");
    }
    function sqrt(uint256 x) internal pure returns (uint256 z) {
        z = x; uint256 y = x / 2 + 1;
        while (y < z) { z = y; y = (x / y + y) / 2; }
    }
    function deployDestination() external {
        require(block.chainid == 31338, "Local destination only");
        bytes memory factoryCode = vm.getCode("vendor/uniswap/UniswapV3Factory.json");
        bytes memory routerCode = vm.getCode("vendor/uniswap/SwapRouter.json");
        bytes memory managerCode = vm.getCode("vendor/uniswap/NonfungiblePositionManager.json");
        vm.startBroadcast(DEV);
        TestToken token = new TestToken("Local Destination Test USD", "bUSD", 6);
        LocalWETH weth = new LocalWETH();
        LocalRouter router = new LocalRouter(2);
        LocalFeed feed = new LocalFeed();
        address factory = deploy(factoryCode);
        address swap = deploy(bytes.concat(routerCode, abi.encode(factory, address(weth))));
        NFTManager manager = NFTManager(deploy(bytes.concat(managerCode, abi.encode(factory, address(weth), address(0)))));
        token.faucet(); token.faucet(); token.faucet();
        weth.deposit{value: 1 ether}();
        token.approve(address(manager), 2000e6); weth.approve(address(manager), 1 ether);
        bool first = address(token) < address(weth);
        uint160 root = uint160(sqrt(first ? (uint256(1e18) << 192) / 2000e6 : (uint256(2000e6) << 192) / 1e18));
        address pool = manager.createAndInitializePoolIfNecessary(first ? address(token) : address(weth), first ? address(weth) : address(token), 3000, root);
        manager.mint(NFTManager.MintParams(first ? address(token) : address(weth), first ? address(weth) : address(token), 3000, -887220, 887220, first ? 2000e6 : 1 ether, first ? 1 ether : 2000e6, 0, 0, DEV, block.timestamp + 10 minutes));
        token.approve(address(manager), 0); weth.approve(address(manager), 0);
        DestinationExecutor executor = new DestinationExecutor(DestinationExecutor.Config(address(token), address(weth), address(router), 2, 1, swap, 3000, address(feed), 3600, address(0), 0));
        vm.stopBroadcast();
        vm.writeJson(string.concat('{"chainId":31338,"executor":"', vm.toString(address(executor)), '","inputToken":"', vm.toString(address(token)), '","outputToken":"', vm.toString(address(weth)), '","router":"', vm.toString(address(router)), '","swapRouter":"', vm.toString(swap), '","pool":"', vm.toString(pool), '"}'), "deployments/local-destination.json");
    }
    function pairSource() external {
        require(block.chainid == 31337, "Local source only");
        SourceEscrow source = SourceEscrow(vm.envAddress("LOCAL_SOURCE_ADDRESS"));
        address peer = vm.envAddress("LOCAL_DESTINATION_ADDRESS");
        vm.startBroadcast(DEV); source.pairPeer(peer); vm.stopBroadcast();
    }
    function pairDestination() external {
        require(block.chainid == 31338, "Local destination only");
        DestinationExecutor destination = DestinationExecutor(vm.envAddress("LOCAL_DESTINATION_ADDRESS"));
        address peer = vm.envAddress("LOCAL_SOURCE_ADDRESS");
        vm.startBroadcast(DEV); destination.pairPeer(peer); vm.stopBroadcast();
    }
}
