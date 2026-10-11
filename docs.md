# DLMM Pro SDK

`@meteora-ag/dlmm-pro-sdk` `0.1.0` targets DLMM Pro release `0.1.0`
(`dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n`) and the access-registry
program (`regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`). Both IDLs are spec
`0.1.0`.

The package is JavaScript plus `.d.ts`. `@coral-xyz/anchor` `0.32` and
`@solana/web3.js` v1 are dependencies. TypeScript is not a peer dependency.

The Rust crate `dlmm-pro-commons` is `publish = false`. Depend on it from git.

## Client surface

`DlmmProClient.create(connection, commitment?, programId?)` exposes:

| Service          | Instructions                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pool`           | `initializePoolWithStaticConfig`, `initializePoolWithDynamicConfig`, `initializeLaunchPool`, `initializeTickArray`, `initializeTickBitmapExtension`, `increaseOracleLength`, `swap`, `claimPartnerFee`, `quoteExactIn`                                                                                                                       |
| `position`       | `openPosition`, `expandPosition`, `removePosition`, `closePosition`, `addLiquidity`, `addLiquidityByWeight`, `addLiquidityImbalance`, `removeLiquidity`, `removeLiquidityByBps`, `refreshFeesAndRewards`, `claimFee`, `getClaimableFees`, `compoundFees`, `lockPermanentPosition`, `lockVestingPosition`, `updatePositionDelegatePermission` |
| `limitOrder`     | `openLimitOrder`, `cancelLimitOrder`, `closeLimitOrder`, `updateLimitOrderDelegatePermission`                                                                                                                                                                                                                                                |
| `reward`         | `initializeReward`, `updateRewardAuthority`, `setRewardEmission`, `claimReward`, `withdrawIneligibleRewards`                                                                                                                                                                                                                                 |
| `accessRegistry` | `fetchTokenBadge`                                                                                                                                                                                                                                                                                                                            |
| `state`          | Decode pool, position, tick array, oracle, limit-order, config, and operator accounts                                                                                                                                                                                                                                                        |

Creating operators and configs, closing them, setting pool status, updating
the partner fee, and claiming protocol fees are not part of this client.

Builders mirror the program's parameter checks that need no account state, in
the program's order, and throw a `PoolError` carrying the same code the
instruction would return. Checks that depend on the current slot or timestamp
are left to the program.

## Delegates

A position or limit-order NFT holder can approve a delegate on the NFT token
account (Token-2022 `approve`, amount 0) and grant permissions with
`updatePositionDelegatePermission` / `updateLimitOrderDelegatePermission`.
`PositionDelegatePermission` is `AddLiquidity`, `RemoveLiquidity`, `ClaimFee`,
`ClaimReward`, `UpdatePositionRange`; `LimitOrderDelegatePermission` is
`CancelLimitOrder`. `refreshFeesAndRewards` accepts any delegate.

When `signer` is not `owner`:

- `claimFee`, `removeLiquidity`, `removeLiquidityByBps`, `cancelLimitOrder`,
  and `claimReward` require the owner's associated token account for each
  mint. The builders throw `IncorrectATA` otherwise; the program checks each
  account whose transfer is non-zero (`claimReward` always).
- `removePosition` requires `rentReceiver` to be the owner (`InvalidPermission`).
- `lockPermanentPosition` and `lockVestingPosition` take only `owner`; the
  program requires the owner to sign.

## Rewards

Creator `initializeReward` fills slot `CREATOR_REWARD_INDEX` with `operator`
null. A signer other than the pool creator fails with `InvalidPermission`. A
reward mint with a freeze authority fails with `UnsupportedMint` unless the
mint is whitelisted (native SOL or USDC) or `tokenBadge` is set.
`updateRewardAuthority` fails a non-creator with `MissingOperatorAccount`,
because that instruction requires the operator account when the signer is not
the creator.

`setRewardEmission`, `claimReward`, and `withdrawIneligibleRewards` read the
reward slot and throw `InvalidRewardIndex`, `RewardUninitialized`, or
`InvalidRewardMint` in the program's order. `setRewardEmission` and
`withdrawIneligibleRewards` also require `authority` to be the slot's
authority (`InvalidPermission`), and with an explicit `openTime`
`setRewardEmission` requires `endTime - openTime` within
`MIN_REWARD_DURATION..=MAX_REWARD_DURATION`.

## Vesting

`lockVestingPosition` caps `cliff + periodFrequency * numberOfPeriod` at
`MAX_VESTING_DURATION` seconds for timestamp-activated pools and
`MAX_VESTING_DURATION_SLOT` slots (`MS_PER_SLOT` = 250 ms) for slot-activated
pools. The builder fetches the pool only when the schedule exceeds the
timestamp cap.

## Limit orders

`RelativeTick` is a band of spacing-aligned tick ids. The program places
relative orders at `alignDown(tickCurrentId, tickSpacing) + id * tickSpacing`
and rejects the order with `ExceededSlippage` when the aligned current tick
leaves `[spacingAlignedMinTickId, spacingAlignedMaxTickId]`.
`relativeTickFromSlippage({ currentTickId, tickSpacing, slippageTicks })`
builds that band; `slippageTicks` must be a multiple of `tickSpacing`.
`openLimitOrder` fetches the pool and rejects unaligned band edges, and
unaligned absolute tick ids, with `InvalidParameters`.

Bonding-curve pools are dynamic or launch pools. A bonding-curve slot needs a
non-default whitelisted depositor and a target sqrt price that stays inside the
spacing-aligned max tick.

## Quotes

`quoteExactIn` ports the on-chain swap loop: dynamic fee, market-maker
liquidity, in-tick limit orders, collect-fee mode, and Token-2022 transfer
fees. `transferFeeExcludedOutAmount` is what the swapper receives. For a hot
path, fetch accounts yourself and call the pure `quoteExactIn` instead of
`client.pool.quoteExactIn`.

The dynamic fee is read once, before the tick loop, after the reference update
the program performs at the start of a swap: references reset when the last
reference is older than `MAX_REFERENCE_AGE` (3600 s), stay put within
`filterPeriod` of the last reference or significant swap, decay by
`reductionFactor` within `decayPeriod`, and clear after it.

`postSwapActivations` is one entry per activation slot:

- `activationMode`
- `isReachTarget` after the quote
- `reachedTarget` when a bonding-curve slot flips on this swap

The program writes that flag only after the swap consumes the full input.
A quote with `amountLeft > 0` leaves `isReachTarget` unchanged and
`reachedTarget` false, because that swap reverts with `NotConsumingFullAmountIn`
before the write. Open and time-based slots are no-ops.

Oracle observations and fee-growth writes are not returned. Swap amounts match
the program.

`referral` may be the swapper's own output token account. The swap account
is `mut` with Anchor's `dup` constraint, so the same mutable account is
accepted and the host fee is paid into that account.

`multiplierFromAmounts` accounts for transfer fees when given unpacked mints
and the current epoch; `getLiquidityFromAmounts` takes and
`getAmountsFromLiquidity` returns pool-side amounts before transfer fees.
`buildLiquidityShape` rejects shapes over `POSITION_MAX_RANGE` ranges unless
`maxRanges` is set, in which case `compressRanges` merges the closest weights.

`client.position.getClaimableFees` previews what `claimFee` would transfer
from the current pool and tick state. `client.position.compoundFees` builds
refresh + claim + `addLiquidityImbalance` into one slot in a single
transaction; the deposit is capped at the claimable amounts unless you pass
`maxAmountX` / `maxAmountY` (`null` to keep one side in the wallet, which the
program only allows when the slot is entirely on the other side of the price),
and takes the usual `slippage` and `expectedLayoutVersion` guards.

## Transfer hooks

Builders resolve Token-2022 transfer-hook metas when the corresponding array
is omitted. Pass an array, including `[]`, to skip that resolution.

The amount given to the hook is the amount the program transfers. The builder
reads it only after the mint has a transfer hook, and it omits the slice when
that amount is zero because the program skips the transfer. Resolution throws
when the amount cannot be determined. It does not substitute a slippage bound
or the swap input.

Allowed slices follow the program:

- swap and cancel limit order: X, Y, referral
- liquidity and partner fee: X, Y
- rewards: reward only
- open limit order: the on-side mint only

Deposit legs move tokens from the user to the reserve with the user as
authority. Withdraw legs move tokens from the reserve to the user with the
pool authority.

`swap` uses `parameters.inputAmount` on the input leg. The output leg uses
`quotedOutAmount` when set, otherwise `quoteExactIn` over that swap's tick
arrays (`outAmount`, pool-side, before the output transfer fee). The referral
leg uses `quotedHostFee` when set, otherwise that quote's `hostFee`, and only
when the referral token account is the fee mint. Deposits use the fee-included
token deltas, capped by `maxAmount`. Withdrawals use the pool-side deltas.
Claims use the post-refresh amounts the program transfers.

## Versioning

Publish the TypeScript package on a GitHub release whose tag is
`v<package version>`. The Rust crate is not published. Keep the two IDL copies
(`src/idl/dlmm-pro/dlmm_pro.json` and `commons/idls/dlmm_pro.json`) identical;
`make idl` diffs them.
