// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Bisharp, IPriceFeed} from "../src/Bisharp.sol";
import {TestToken} from "../src/TestToken.sol";

interface DeployVm {
    function envAddress(string calldata) external returns (address);
    function envUint(string calldata) external returns (uint256);
    function envOr(string calldata, uint256) external returns (uint256);
    function startBroadcast() external;
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
    function toString(address) external pure returns (string memory);
    function writeFile(string calldata, string calldata) external;
}

contract Deploy {
    DeployVm constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event Deployment(address escrow, address inputToken, address outputToken, address priceFeed);

    function run() external {
        require(block.chainid == 11155111, "Sepolia only");
        address feed = vm.envAddress("PRICE_FEED");
        uint256 age = vm.envUint("MAX_PRICE_AGE");
        // Fail before broadcasting if the selected feed is absent or stale.
        require(feed.code.length > 0 && IPriceFeed(feed).decimals() == 8, "Verify ETH/USD feed");
        (, int256 answer,, uint256 updated,) = IPriceFeed(feed).latestRoundData();
        require(answer > 0 && updated > 0 && updated <= block.timestamp && block.timestamp - updated <= age, "Feed stale");
        uint256 testKey = vm.envOr("SEPOLIA_PRIVATE_KEY", uint256(0));
        if (testKey == 0) vm.startBroadcast();
        else vm.startBroadcast(testKey);
        TestToken usd = new TestToken("Bisharp Test USD", "bUSD", 6);
        TestToken eth = new TestToken("Bisharp Test Ether", "bETH", 18);
        Bisharp escrow = new Bisharp(address(usd), address(eth), feed, age);
        vm.stopBroadcast();
        emit Deployment(address(escrow), address(usd), address(eth), feed);
        vm.writeFile("deployments/sepolia.json", string.concat(
            '{"chainId":11155111,"escrow":"', vm.toString(address(escrow)),
            '","inputToken":"', vm.toString(address(usd)),
            '","outputToken":"', vm.toString(address(eth)),
            '","priceFeed":"', vm.toString(feed), '"}'
        ));
    }
}
