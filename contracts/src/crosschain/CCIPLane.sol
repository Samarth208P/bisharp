// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CCIPReceiver} from "@ccip/applications/CCIPReceiver.sol";
import {Client} from "@ccip/libraries/Client.sol";
import {ExtraArgsCodec} from "@ccip/libraries/ExtraArgsCodec.sol";
import {FinalityCodec} from "@ccip/libraries/FinalityCodec.sol";
import {IRouterClient} from "@ccip/interfaces/IRouterClient.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OrderTypes as O} from "./OrderTypes.sol";

/// @notice One permanently paired lane. Native fee refunds are independent of token principal.
abstract contract CCIPLane is CCIPReceiver, ReentrancyGuard {
    uint64 public immutable localSelector;
    uint64 public immutable remoteSelector;
    address public peer;
    address public pairingAuthority;
    mapping(address => uint256) public nativeCredits;
    mapping(bytes32 => bool) public received;
    event PeerPaired(address indexed peer);
    event MessageSent(bytes32 indexed messageId, uint256 indexed orderId, O.Kind kind, uint256 fee);
    event MessageReceived(bytes32 indexed messageId, uint256 indexed orderId, O.Kind kind);
    error InvalidConfiguration();
    error InvalidMessage();
    error InvalidState();
    error Unauthorized();
    error InsufficientFee(uint256 required, uint256 supplied);

    constructor(address router, uint64 local_, uint64 remote_) CCIPReceiver(router) {
        if (router.code.length == 0 || local_ == 0 || remote_ == 0 || local_ == remote_) revert InvalidConfiguration();
        localSelector = local_; remoteSelector = remote_; pairingAuthority = msg.sender;
    }

    /// @dev One-time bootstrap only. No ongoing ability to change counterparties.
    function pairPeer(address peer_) external {
        if (msg.sender != pairingAuthority || peer != address(0)) revert Unauthorized();
        if (peer_ == address(0) || peer_ == address(this)) revert InvalidConfiguration();
        peer = peer_;
        pairingAuthority = address(0);
        emit PeerPaired(peer_);
    }

    function _message(O.Envelope memory envelope, uint32 gasLimit) internal view returns (Client.EVM2AnyMessage memory) {
        if (peer == address(0) || gasLimit < 200_000 || gasLimit > 1_000_000) revert InvalidConfiguration();
        return Client.EVM2AnyMessage({
            receiver: abi.encode(peer), data: abi.encode(envelope),
            tokenAmounts: new Client.EVMTokenAmount[](0), feeToken: address(0),
            extraArgs: ExtraArgsCodec._getBasicEncodedExtraArgsV3(gasLimit, FinalityCodec.WAIT_FOR_FINALITY_FLAG)
        });
    }

    function _fee(O.Envelope memory envelope, uint32 gasLimit) internal view returns (uint256) {
        return IRouterClient(getRouter()).getFee(remoteSelector, _message(envelope, gasLimit));
    }

    function _send(O.Envelope memory envelope, uint32 gasLimit) internal returns (bytes32 messageId) {
        Client.EVM2AnyMessage memory message = _message(envelope, gasLimit);
        uint256 fee = IRouterClient(getRouter()).getFee(remoteSelector, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);
        nativeCredits[msg.sender] += msg.value - fee;
        messageId = IRouterClient(getRouter()).ccipSend{value: fee}(remoteSelector, message);
        emit MessageSent(messageId, envelope.id, envelope.kind, fee);
    }

    function claimNative(address payable beneficiary) external nonReentrant {
        uint256 value = nativeCredits[beneficiary];
        if (value == 0) revert InvalidState();
        nativeCredits[beneficiary] = 0;
        (bool ok,) = beneficiary.call{value: value}("");
        if (!ok) revert InvalidState();
    }

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override nonReentrant {
        if (peer == address(0) || message.sourceChainSelector != remoteSelector || message.sender.length != 32 || abi.decode(message.sender, (address)) != peer || message.destTokenAmounts.length != 0) revert InvalidMessage();
        if (received[message.messageId]) return;
        O.Envelope memory envelope = abi.decode(message.data, (O.Envelope));
        if (envelope.version != O.VERSION || envelope.id == 0) revert InvalidMessage();
        received[message.messageId] = true;
        _receiveEnvelope(envelope);
        emit MessageReceived(message.messageId, envelope.id, envelope.kind);
    }

    function _receiveEnvelope(O.Envelope memory envelope) internal virtual;
}
