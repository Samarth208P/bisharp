# Pinned Solidity dependencies

Only the CCIP application/interface/codec source subset needed by Bisharp is vendored. Files are copied unchanged from the official npm archive `@chainlink/contracts-ccip@2.0.0`.

- Archive SHA-256: `59c3ea7be405d68cadd948ac1c8ee5e0b7df4d1cdcde709bf1515e009d5dd759`.
- Original paths: `package/contracts/applications/CCIPReceiver.sol`, the three imported interfaces, `Client.sol`, `ExtraArgsCodec.sol`, `FinalityCodec.sol`, and `contracts/LICENSE.md`.
- Upstream repository: https://github.com/smartcontractkit/chainlink-ccip
- Each included Solidity source carries its upstream SPDX license; the package license is preserved in `ccip/LICENSE.md`.
- The upstream `@openzeppelin/contracts@5.3.0` import is an IERC165 interface only; the Foundry remapping resolves it to the ABI-compatible IERC165 in the project's pinned OpenZeppelin 5.4.0. Upstream source files are not edited.

Vendoring avoids installing the CCIP package's unrelated development-tool dependency tree. It does not replace on-chain router, lane, version, finality or configuration verification. Dependency archives are not executable application code and have no credentials.

## Uniswap artifacts

Unmodified official deployment artifacts are retained for integration tests and reproducible testnet fixtures: factory from `@uniswap/v3-core@1.0.1`; router and position manager from `@uniswap/v3-periphery@1.4.4`. Their original bytecode was compiled with Solidity 0.7.6. Source repository: https://github.com/Uniswap/v3-core and https://github.com/Uniswap/v3-periphery. Original package licenses are in `uniswap/CORE-LICENSE` and `uniswap/PERIPHERY-LICENSE`.

- Core archive SHA-256: `141b001e2a376fff867cb24e0713b2834095cb1250c13aae263d9a646446d329`.
- Periphery archive SHA-256: `7177174c4b8c66bd1d61e7c4127ee15e95f851edfb1a65ee8225b6ab4f818bd7`.

These are upstream protocol artifacts, not Bisharp-authored swap mocks. A locally deployed artifact test still does not establish public testnet liquidity or a completed prize submission.
