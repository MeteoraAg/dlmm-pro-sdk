# dlmm-pro-commons

Off-chain math, quotes, account state, and PDA helpers for the DLMM Pro program. The crate is `publish = false`. Depend on it from git.

`quote_exact_in` follows the on-chain swap loop, including fees and bonding-curve graduation. It does not return oracle samples or fee-growth writes. Instruction builders for the program live in the TypeScript package, not here.

Pinned to dlmm-pro release 0.1.0 (dc65a03). The LiteSVM tests load the binaries under `tests/fixtures/` at the repository root: the dlmm-pro 0.1.0 binary and the access-registry `d542263` binary, both built with `--features local`.
