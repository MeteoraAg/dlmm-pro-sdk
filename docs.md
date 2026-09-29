# DLMM Pro SDK

`@meteora-ag/dlmm-pro-sdk` `0.1.0` targets the DLMM Pro program
`dProsbmsDQTXqfYkseAShmotRn53K5YJGzmjXaZXN5w` and the access-registry program
`regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`. Both IDLs are spec `0.1.0`.

The package is JavaScript plus `.d.ts`. `@coral-xyz/anchor` `0.32` and
`@solana/web3.js` v1 are dependencies. TypeScript is not a peer dependency.

The Rust crate `dlmm-pro-commons` is `publish = false`. Depend on it from git.

## Client surface

`DlmmProClient.create(connection)` exposes:

| Service          | What it builds                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `pool`           | Initialize static, dynamic, and launch pools, swap, claim partner fee, quote                    |
| `position`       | Open, add, remove, claim fees, compound, close                                                  |
| `limitOrder`     | Open, cancel, close                                                                             |
| `reward`         | Initialize, update authority, fund, claim, withdraw ineligible                                  |
| `operator`       | Create and close operators and configs, set pool status, update partner fee, claim protocol fee |
| `accessRegistry` | Fetch, create, and close registry operators and token badges                                    |
| `state`          | Decode pool, position, tick array, oracle, and limit-order accounts                             |

Creator `initializeReward` leaves `operator` null. A signer other than the pool
creator fails with `InvalidPermission`. A reward mint with a freeze authority
fails with `UnsupportedMint` unless the mint is whitelisted (native SOL or
USDC) or `tokenBadge` is set. `updateRewardAuthority` still fails a non-creator
with `MissingOperatorAccount`, because that instruction requires the operator
account when the signer is not the creator.

`claimProtocolFee` sets the protocol-fee authority PDA
(`FkU5rQCWQM131skHCpcEbK8P1JrQGsBgqXe55w525SSF`) as the instruction signer.
Pass `payer` for the transaction fee. The external protocol-fee program has
to sign.

Static configs reject the activation extension. Bonding-curve pools are
dynamic or launch pools. A bonding-curve slot needs a non-default whitelisted
depositor and a target sqrt price that stays inside the spacing-aligned max tick.

## Quotes

`quoteExactIn` ports the on-chain swap loop: dynamic fee, market-maker
liquidity, in-tick limit orders, collect-fee mode, and Token-2022 transfer
fees. `transferFeeExcludedOutAmount` is what the swapper receives.

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
- liquidity, partner fee, protocol fee: X, Y
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

Publish the TypeScript package on a GitHub release. The Rust crate is not
published. Keep the two IDL copies (`src/idl/dlmm-pro/dlmm_pro.json` and
`commons/idls/dlmm_pro.json`) identical; `make idl` diffs them.
