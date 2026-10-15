# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## @meteora-ag/dlmm-pro-sdk [0.1.0] - [PR #16](https://github.com/MeteoraAg/dlmm-pro-sdk/pull/16)

### Added

- `DlmmProClient` targets DLMM Pro release 0.1.0. Its `pool`, `position`, `limitOrder`, `reward`, `state`, and `accessRegistry` services build the user-facing instructions and read program accounts. `createDlmmProProgram` and `createAccessRegistryProgram` return Anchor programs for the operator and admin instructions.
- `quoteExactIn` ports the exact-in swap: dynamic and scheduled fees, market-maker and limit-order liquidity, the collect-fee mode, and Token-2022 transfer fees. `client.pool.quoteExactIn` also returns the tick arrays and bitmap extension the swap needs.
- Builders resolve the Token-2022 transfer-hook accounts of each transfer whose `transferHook*` array is omitted. An explicit array, including `[]`, is sent as given.
- The limit-order builders derive the tick arrays they need, and builders pass the pool's bitmap extension when the instruction needs it.
- `getClaimableFees` previews a fee claim. `compoundFees` claims fees and redeposits them in one transaction.
- `buildLiquidityShape` builds Spot, Curve, BidAsk, or custom-weight deposits in a vertical or horizontal layout. `multiplierFromAmounts`, `encodeAddLiquidityByWeight`, `limitOrderTicksFromShape`, and `relativeTickFromSlippage` turn a shape into deposit or limit-order parameters.
- `encodeFixedBaseFeeData`, `encodeTimeSchedulerBaseFeeData`, `encodeMarketCapSchedulerBaseFeeData`, `openActivationParameters`, `bondingCurveActivationParameters`, and `timeBasedActivationParameters` encode pool-creation parameters. `getBaseFeeNumerator` evaluates a pool's base fee.
- PDA, tick, liquidity, permission, and account-decoding helpers.
- The IDLs of both programs, exported from the package root and as `@meteora-ag/dlmm-pro-sdk/idl/dlmm-pro` and `@meteora-ag/dlmm-pro-sdk/idl/access-registry`.
