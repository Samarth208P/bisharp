// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Client} from "@ccip/libraries/Client.sol";
import {CCIPReceiver} from "@ccip/applications/CCIPReceiver.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Deliberately unauthenticated local transport. Cannot deploy on public chains.
/// This fixture is NOT Chainlink CCIP security and MUST NOT be used as prize evidence.
contract LocalRouter {
    uint64 public immutable selector;
    uint256 public nonce;
    event Queued(bytes32 indexed messageId, uint64 destinationSelector, address receiver, address sender, bytes data);

    constructor(uint64 selector_) {
        require(block.chainid == 31337 || block.chainid == 31338, "Local only");
        selector = selector_;
    }

    function isChainSupported(uint64 target) external view returns (bool) {
        return target != 0 && target != selector;
    }

    function getFee(uint64, Client.EVM2AnyMessage calldata) external pure returns (uint256) {
        return 1e12;
    }

    function ccipSend(uint64 target, Client.EVM2AnyMessage calldata message) external payable returns (bytes32 id) {
        require(msg.value == 1e12 && target != selector && message.tokenAmounts.length == 0, "Local fee/route");
        id = keccak256(abi.encode(block.chainid, address(this), ++nonce));
        emit Queued(id, target, abi.decode(message.receiver, (address)), msg.sender, message.data);
    }

    function relay(bytes32 id, uint64 fromSelector, address sender, address receiver, bytes calldata data) external {
        CCIPReceiver(receiver)
            .ccipReceive(
                Client.Any2EVMMessage(id, fromSelector, abi.encode(sender), data, new Client.EVMTokenAmount[](0))
            );
    }
}

contract LocalFeed {
    constructor() {
        require(block.chainid == 31337 || block.chainid == 31338, "Local only");
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 2000e8, block.timestamp, block.timestamp, 1);
    }
}

contract LocalWETH is ERC20 {
    constructor() ERC20("Local Wrapped Ether", "WETH") {
        require(block.chainid == 31338, "Local destination only");
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Native transfer");
    }
}
