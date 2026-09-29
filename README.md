# DLMM Pro SDK

TypeScript client and Rust commons for [DLMM Pro](https://github.com/MeteoraAg/dlmm-pro).

Program ID (mainnet and devnet): `dProsbmsDQTXqfYkseAShmotRn53K5YJGzmjXaZXN5w`

```
src/           @meteora-ag/dlmm-pro-sdk (TypeScript)
commons/       dlmm-pro-commons (Rust, publish = false)
src/idl/       IDL the TS package ships
commons/idls/  same IDL for declare_program!; CI diffs the two copies
```

## TypeScript

```bash
pnpm add @meteora-ag/dlmm-pro-sdk
```

```typescript
import { Connection } from "@solana/web3.js";
import { BN } from "bn.js";
import { DlmmProClient } from "@meteora-ag/dlmm-pro-sdk";

const client = DlmmProClient.create(
  new Connection("https://api.mainnet-beta.solana.com"),
);

const { quote, tickArrays, tickArrayBitmapExtension } =
  await client.pool.quoteExactIn({
    pool,
    inputAmount: new BN(1_000_000),
    swapForY: true,
  });

// quote.transferFeeExcludedOutAmount is what the swapper receives.
// quote.postSwapActivations reports bonding-curve graduation when the swap
// would consume the full input. Pass tickArrays / tickArrayBitmapExtension
// through to client.pool.swap. Swap, liquidity, and reward builders resolve
// Token-2022 transfer-hook accounts when you omit the hook arrays.
```

`DlmmProClient` is a thin wrapper over instruction builders and account
decoders: `pool`, `position`, `limitOrder`, `reward`, `state`, and
`accessRegistry`. `accessRegistry` fetches token badges. Creating operators,
configs, and badges, setting pool status, updating the partner fee, and
claiming protocol fees are not part of this client.
Math, PDAs, activation, base-fee encoding, and deposit weights are also
exported from the package root. Package version `0.1.0` tracks program IDL
`0.1.0`. See `docs.md` for instruction coverage, quotes, and transfer hooks.

`quoteExactIn` is a port of the on-chain swap loop (dynamic fee, MM liquidity,
in-tick limit orders, collect-fee mode, Token-2022 transfer fees). For a hot
path, fetch accounts yourself and call the pure `quoteExactIn` instead of
`client.pool.quoteExactIn`.

`quoteExactIn` includes transfer fees. `multiplierFromAmounts` also accounts
for them when given unpacked mints and the current epoch;
`getLiquidityFromAmounts` takes and `getAmountsFromLiquidity` returns pool-side
amounts before transfer fees.

`client.position.getClaimableFees` previews what `claimFee` would transfer
from the current pool and tick state. `client.position.compoundFees` builds
refresh + claim + `addLiquidityImbalance` into one slot in a single
transaction; the deposit is capped at the claimable amounts unless you pass
`maxAmountX` / `maxAmountY` (`null` to keep one side in the wallet, which the
program only allows when the slot is entirely on the other side of the price),
and takes the usual `slippage` and `expectedLayoutVersion` guards.

IDL JSON is exported from `@meteora-ag/dlmm-pro-sdk/idl/dlmm-pro` and
`@meteora-ag/dlmm-pro-sdk/idl/access-registry`.

## Rust

```toml
[dependencies]
dlmm-pro-commons = { git = "https://github.com/MeteoraAg/dlmm-pro-sdk" }
```

The crate is not on crates.io (`publish = false`). It provides:

- `declare_program!(dlmm_pro)` types and ix builders:
  `dlmm_pro_commons::dlmm_pro::client::{accounts, args}`
- PDAs (`derive_pool`, `derive_tick_array`, …) and program constants
- Parsers for the header + dynamic-tail layout (`DynamicPool`,
  `DynamicTickArray`, `DynamicOracle`, `DynamicLimitOrder`,
  `DynamicPositionArray`)
- `tick_arrays_for_swap` and transfer-hook remaining accounts
- `quote_exact_in`, same coverage as the TypeScript quote
- `claimable_fees`, the pending swap-fee preview behind `getClaimableFees`

```rust
use dlmm_pro_commons::*;

let pool_state = DynamicPool::deserialize(&pool_account_data)?;
let selection = tick_arrays_for_swap(pool, &pool_state.pool, None, swap_for_y, 3)?;
// fetch selection.tick_arrays, then:
let quote = quote_exact_in(QuoteExactInParams { /* parsed accounts + clock */ })?;
```

There is no Rust RPC client equivalent of `DlmmProClient`. Build instructions
from `dlmm_pro::client` after fetching accounts and verifying their owners.

## Develop

Node 22, pnpm, Rust 1.94.0 (`rust-toolchain.toml`, rustfmt + clippy).

```bash
pnpm install
make fmt-check-ts
make typecheck
make test-ts
make build
```

`make check`, `make test`, `make idl`, `make clippy`, and `make test-rs` also
run the Rust crate. They need `commons/` in the tree. `make idl` diffs
`src/idl/dlmm-pro/dlmm_pro.json` with `commons/idls/dlmm_pro.json`. Cargo
targets pass `--locked`. `pnpm test:rust` is the same `cargo test --workspace
--locked`.

CI is split the same way:

- `.github/workflows/sdk.yml` runs the TypeScript checks on `ubuntu-24.04-arm`.
  x86_64 LiteSVM's SBF JIT corrupts Node, so the TypeScript job stays on ARM.
- `.github/workflows/commons.yml` runs `cargo fmt`, `clippy --locked`, and
  `cargo test --locked` on `ubuntu-latest`.

LiteSVM loads a program binary built with `--features local` (that flag stubs
the admin check). TypeScript tests use `tests/fixtures/dlmm_pro.so` and
`tests/fixtures/access_registry.so`. Rust tests use
`commons/fixtures/dlmm_pro.so`. Both sides honor `DLMM_PRO_SO_PATH`.

Test tokens: https://faucet.raccoons.dev/
