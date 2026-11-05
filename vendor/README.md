# Pinned Solidity dependencies

Only the CCIP application/interface/codec source subset needed by Bisharp is vendored. Files are copied unchanged from the official npm archive `@chainlink/contracts-ccip@2.0.0`.

- Archive SHA-256: `59c3ea7be405d68cadd948ac1c8ee5e0b7df4d1cdcde709bf1515e009d5dd759`.
- Original paths: `package/contracts/applications/CCIPReceiver.sol`, the three imported interfaces, `Client.sol`, `ExtraArgsCodec.sol`, `FinalityCodec.sol`, and `contracts/LICENSE.md`.
- Upstream repository: https://github.com/smartcontractkit/chainlink-ccip
- Each included Solidity source carries its upstream SPDX license; the package license is preserved in `ccip/LICENSE.md`.
- The upstream `@openzeppelin/contracts@5.3.0` import is an IERC165 interface only; the Foundry remapping resolves it to the ABI-compatible IERC165 in the project's pinned OpenZeppelin 5.4.0. Upstream source files are not edited.

Vendoring avoids installing the CCIP package's unrelated development-tool dependency tree. It does not replace on-chain router, lane, version, finality or configuration verification. Dependency archives are not executable application code and have no credentials.
