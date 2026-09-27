# dlmm-pro-commons

Off-chain math, quotes, account state, and PDA helpers for the DLMM Pro program. The crate is `publish = false`. Depend on it from git.

`quote_exact_in` follows the on-chain swap loop, including fees and bonding-curve graduation. It does not return oracle samples or fee-growth writes. Instruction builders for the program live in the TypeScript package, not here.

The LiteSVM fixtures in `fixtures/` are the `dlmm-pro` `main` `9590139` binary and the access-registry `d542263` binary, both built with `--features local`.
