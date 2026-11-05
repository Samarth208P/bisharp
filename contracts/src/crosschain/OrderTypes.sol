// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library OrderTypes {
    uint8 internal constant VERSION = 1;
    enum Kind {
        Create,
        Cancel,
        Filled,
        Cancelled
    }
    enum State {
        Unknown,
        Open,
        CancelRequested,
        Filled,
        Cancelled
    }

    // Two 128-bit values share a slot. Addresses stay explicit and immutable per order.
    struct Terms {
        address owner;
        address recipient;
        address solver;
        uint64 deadline;
        uint128 principal;
        uint128 amountIn;
        uint128 minOutput;
        uint128 maxPrice;
    }

    struct Record {
        Terms terms;
        bytes32 termsHash;
        State state;
        bool claimed;
    }

    struct Envelope {
        uint8 version;
        Kind kind;
        uint256 id;
        bytes32 termsHash;
        Terms terms;
    }

    function hash(
        address source,
        address destination,
        uint64 sourceSelector,
        uint64 destinationSelector,
        uint256 id,
        Terms memory terms
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(VERSION, source, destination, sourceSelector, destinationSelector, id, terms));
    }
}
