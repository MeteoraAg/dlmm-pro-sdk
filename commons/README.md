# dlmm-pro-commons

Off-chain math, quotes, account state, and PDA helpers for the DLMM Pro program. The crate is `publish = false`. Depend on it from git.

`quote_exact_in` follows the on-chain swap loop, fees included, over the tick arrays `tick_arrays_for_swap` selects. It does not return oracle samples or fee-growth writes. `claimable_fees` and `claimable_rewards` preview what a claim transfers once every position slot holding liquidity is refreshed.

`dlmm_pro::client::{accounts, args}` from `declare_program!` give each instruction's accounts and arguments. There is no RPC client and no higher-level instruction builder.

The `declare_program!` account types read the whole account after the discriminator as their header, so their `AccountDeserialize` panics on `Pool` accounts with extensions and on `TickArray`, `PositionArray`, `LimitOrder` and `Oracle` accounts. Parse those with `DynamicPool`, `DynamicTickArray`, `DynamicPositionArray`, `DynamicLimitOrder` and `DynamicOracle`.

Pinned to dlmm-pro release 0.1.0 (4ac3a79). The LiteSVM tests load the binaries under `tests/fixtures/` at the repository root: the dlmm-pro 0.1.0 binary and the access-registry `d542263` binary, both built with `--features local`.
