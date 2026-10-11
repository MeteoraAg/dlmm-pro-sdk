# Changelog

## 0.1.0

First publishable TypeScript package and Rust commons crate. Both track DLMM
Pro release `0.1.0` (`dc65a03`), program id
`dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n`, and access-registry `d542263`.

Changes against the pre-release program the stack was first written for
(`9590139`):

- Program id, pool-authority address, and the IDL `address` field.
- `PoolErrorCode`: `InvalidRewardMint` is 6030; every later code moved up by one.
- `PositionDelegatePermission` is `AddLiquidity`, `RemoveLiquidity`,
  `ClaimFee`, `ClaimReward`, `UpdatePositionRange`;
  `LimitOrderDelegatePermission` is `CancelLimitOrder`. The `*ToOwner` and
  `LockLiquidity` variants are gone.
- A delegate withdraws only to the owner's associated token accounts.
  `claimFee`, `removeLiquidity`, `removeLiquidityByBps`, `cancelLimitOrder`,
  and `claimReward` throw `IncorrectATA` otherwise; `removePosition` throws
  `InvalidPermission` for a delegate naming another rent receiver.
  `lockPermanentPosition` and `lockVestingPosition` no longer take `signer`.
- `setRewardEmission`, `claimReward`, and `withdrawIneligibleRewards` check the
  reward slot's mint and authority before building.
- `RelativeTick` is `{ spacingAlignedMinTickId, spacingAlignedMaxTickId }`.
  `relativeTickFromSlippage` takes `{ currentTickId, tickSpacing,
slippageTicks }`. `openLimitOrder` fetches the pool and rejects unaligned
  tick ids.
- `lockVestingPosition` caps the schedule at `MAX_VESTING_DURATION_SLOT` for
  slot-activated pools. `MS_PER_SLOT` is 250 and `MAX_SLOT_BUFFER` follows it.
- Dynamic fee: `DynamicFeeParameters.minDeltaTickForSignificantSwap`,
  `VariableFee.lastSignificantSwapTimestamp` / `lastReferenceTimestamp`,
  `MAX_REFERENCE_AGE`, and the reference-update rewrite in `quoteExactIn`.
  `validateDynamicFeeParameters` also caps the maximum variable fee at
  `MAX_FEE_NUMERATOR`.
- Account sizes: `Pool` 640, `StaticConfig` 120, `PositionArray` 136,
  `LimitOrder` 136 bytes after the discriminator.

Package:

- `quoteExactIn` reports `postSwapActivations`. The bonding-curve flag flips
  only when the quote consumes the full input.
- Builders resolve Token-2022 transfer-hook accounts when the hook array is
  omitted. An explicit array, including an empty one, is sent as-is.
- `buildLiquidityShape` takes `maxRanges` and compresses through
  `compressRanges`.
- `initializeTickArray` rejects an index with no usable tick,
  `increaseOracleLength` rejects a total over `MAX_OBSERVATION_LENGTH`, and
  the reward builders check the liquidity-mining extension before the
  emission and index, in the program's order. `positionDelegatePermissionMask`
  and `limitOrderDelegatePermissionMask` are bounded by their own enum.
- Removed: `getOrCreateATAInstruction`, `wrapSOLInstruction`,
  `unwrapSOLInstruction`, `findAssociatedTokenAddress`, `getTokenDecimals`,
  `prepareTokenAccountTx`, `cleanUpTokenAccountTx`, `getPriceFromSqrtPrice`,
  `overflowingAdd`, `tryCastBaseFeeMode`, `isOverflowDefaultTickArrayBitmap`
  (use `overflowsDefaultTickArrayBitmap`).
- `typescript` is not a peer dependency. npm publish runs on a GitHub release.

Rust commons:

- `publish = false`; LiteSVM tests share `tests/fixtures/` with the TypeScript
  suite.
- Previews for claimable rewards, ineligible rewards, and vesting unlock match
  the TypeScript helpers.
