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

- `tickPrice` and `tickUiPrice` now keep the precision of the tick's sqrt price. They truncated the price to a multiple of 2^-64, which left about two significant digits near `MIN_TICK_ID`. The `priceLower` and `priceUpper` of the `buildLiquidityShape` columns use the same price.

### Security

## @meteora-ag/dlmm-pro-sdk [0.1.3] - [PR #28](https://github.com/MeteoraAg/dlmm-pro-sdk/pull/28)

### Added

- Added `StrategyType.Wave` to `buildLiquidityShape`, a combination of Spot and BidAsk: flat around the current tick, with each edge stepping up to twice that weight, in at most nine ranges.

## @meteora-ag/dlmm-pro-sdk [0.1.2] - [PR #27](https://github.com/MeteoraAg/dlmm-pro-sdk/pull/27)

### Fixed

- `getSqrtPriceFromTickId` now throws `InvalidParameters` for a tick id outside `MIN_TICK_ID..=MAX_TICK_ID`, instead of returning the sqrt price of a different tick.

## commons [0.1.1] - [PR #26](https://github.com/MeteoraAg/dlmm-pro-sdk/pull/26)

### Fixed

- `quote_exact_in()` now gives the protocol the whole limit order fee of a swap step whose limit order fill rounds down to zero output, as dlmm-pro 0.1.0 does.

### Changed

- Pinned to dlmm-pro 0.1.0, the release deployed on mainnet. `math/` now matches it, which adds a zero check to `down_scale_ceil()`.

## @meteora-ag/dlmm-pro-sdk [0.1.1] - [PR #26](https://github.com/MeteoraAg/dlmm-pro-sdk/pull/26)

### Fixed

- `quoteExactIn` now gives the protocol the whole limit order fee of a swap step whose limit order fill rounds down to zero output, as dlmm-pro 0.1.0 does.
- `initializePoolWithStaticConfig`, `initializePoolWithDynamicConfig` and `initializeLaunchPool` now throw `InvalidTokenBadge` for an `OnlyY` pool when token Y is not wrapped SOL or USDC and no `tokenBadgeY` is passed, instead of building a transaction the program rejects.

### Changed

- Rebuilt the LiteSVM test fixture `tests/fixtures/dlmm_pro.so` from dlmm-pro 0.1.0.

## commons [0.1.0] - [PR #17](https://github.com/MeteoraAg/dlmm-pro-sdk/pull/17)

### Added

- Added `dlmm-pro-commons` crate for DLMM Pro release 0.1.0. It is not published to crates.io, depend on it from git.
- Added `declare_program!(dlmm_pro)` types and instruction structs, generated from the same IDL as the TypeScript SDK.
- Added `DynamicPool`, `DynamicTickArray`, `DynamicPositionArray`, `DynamicLimitOrder` and `DynamicOracle` to support parsing on accounts with dynamic data.
- Added `quote_exact_in()` to quote an exact in swap, and `tick_arrays_for_swap()` to get the tick arrays a swap needs.
- Added `tick_arrays_for_tick_ids()` to get the tick arrays for position and limit order instructions.
- Added Token-2022 transfer fee helpers and `get_extra_account_metas_for_transfer_hook()`.
- Added `claimable_fees()` and `claimable_rewards()` to get the fees and rewards a position can claim, and `get_amounts_from_liquidity()` to get position amounts.
- Added PDA helpers, program constants and `PoolError`.

## @meteora-ag/dlmm-pro-sdk [0.1.0] - [PR #16](https://github.com/MeteoraAg/dlmm-pro-sdk/pull/16)

### Added

- Added `DlmmProClient` with `pool`, `position`, `limitOrder`, `reward` and `state` services for DLMM Pro release 0.1.0.
- Added pool functions `swap`, `initializePoolWithStaticConfig`, `initializePoolWithDynamicConfig`, `initializeLaunchPool`, `initializeTickArray`, `initializeTickBitmapExtension`, `increaseOracleLength` and `claimPartnerFee`.
- Added function `quoteExactIn` to quote an exact in swap. It covers dynamic fee, limit order liquidity, collect fee mode and Token-2022 transfer fee, and returns the tick arrays the swap needs.
- Added position functions `openPosition`, `addLiquidity`, `addLiquidityByWeight`, `addLiquidityImbalance`, `removeLiquidity`, `removeLiquidityByBps`, `claimFee`, `expandPosition`, `removePosition`, `closePosition`, `lockPermanentPosition`, `lockVestingPosition`, `refreshFeesAndRewards` and `updatePositionDelegatePermission`.
- Added function `getClaimableFees` to get the fees a position can claim, and `compoundFees` to claim fees and add them back to the position in one transaction.
- Added limit order functions `openLimitOrder`, `cancelLimitOrder`, `closeLimitOrder` and `updateLimitOrderDelegatePermission`.
- Added reward functions `initializeReward`, `updateRewardAuthority`, `setRewardEmission`, `claimReward` and `withdrawIneligibleRewards`.
- Added function `buildLiquidityShape` to build Spot, Curve, BidAsk or custom liquidity shapes, with `multiplierFromAmounts`, `encodeAddLiquidityByWeight`, `limitOrderTicksFromShape` and `relativeTickFromSlippage` to turn a shape into deposit or limit order parameters.
- Added base fee and activation helpers for pool creation: `encodeFixedBaseFeeData`, `encodeTimeSchedulerBaseFeeData`, `encodeMarketCapSchedulerBaseFeeData`, `openActivationParameters`, `bondingCurveActivationParameters` and `timeBasedActivationParameters`.
- Added base fee builders that take fees in basis points: `fixedBaseFeeParameters`, `timeSchedulerBaseFeeParameters` and `marketCapSchedulerBaseFeeParameters`, with `baseFeeParameters` to pick one by `baseFeeMode` and `bpsToFeeNumerator`.
- Added `getDynamicFeeParams` to build a pool's dynamic fee from a base fee in basis points, capping the variable fee at 20% of that fee.
- Added PDA, tick, liquidity and account decoding helpers.
- Builders resolve Token-2022 transfer hook accounts, tick arrays and the tick array bitmap extension when they are not passed in.
- Exported the DLMM Pro and access registry IDLs, also available as `@meteora-ag/dlmm-pro-sdk/idl/dlmm-pro` and `@meteora-ag/dlmm-pro-sdk/idl/access-registry`.
