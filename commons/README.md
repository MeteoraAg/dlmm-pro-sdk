# dlmm-pro-commons

Off-chain math, quotes, account state, and PDA helpers for the DLMM Pro program. The crate is `publish = false`. Depend on it from git.

`quote_exact_in` follows the on-chain swap loop, including fees and bonding-curve graduation. It does not return oracle samples or fee-growth writes. `claimable_fees` and `claimable_rewards` preview what a refresh and claim transfers, `ineligible_reward_amount` what `withdraw_ineligible_rewards` transfers, and `unlocked_liquidity_for_withdraw` / `bps_removal_parameters` what `remove_liquidity_by_bps` derives from a vesting schedule. Instruction builders for the program live in the TypeScript package, not here.

Pinned to dlmm-pro release 0.1.0 (dc65a03). The LiteSVM tests load the binaries under `tests/fixtures/` at the repository root: the dlmm-pro 0.1.0 binary and the access-registry `d542263` binary, both built with `--features local`.
