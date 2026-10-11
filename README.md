# DLMM Pro SDK

TypeScript client and Rust commons for [DLMM Pro](https://github.com/MeteoraAg/dlmm-pro) release `0.1.0`.

Program ID: `dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n` (devnet).
Access registry: `regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`.

```
src/            @meteora-ag/dlmm-pro-sdk (TypeScript)
commons/        dlmm-pro-commons (Rust, publish = false)
src/idl/        IDL the TS package ships
commons/idls/   same IDL for declare_program!; `make idl` diffs the two copies
tests/fixtures/ LiteSVM program binaries used by both test suites
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
  new Connection("https://api.devnet.solana.com"),
);

const { quote, tickArrays, tickArrayBitmapExtension } =
  await client.pool.quoteExactIn({
    pool,
    inputAmount: new BN(1_000_000),
    swapForY: true,
  });
// quote.transferFeeExcludedOutAmount is what the swapper receives.
// Pass tickArrays and tickArrayBitmapExtension through to client.pool.swap.
```

`DlmmProClient` wraps instruction builders and account decoders: `pool`,
`position`, `limitOrder`, `reward`, `state`, and `accessRegistry`. Math, PDAs,
activation, base-fee encoding, and deposit shapes are exported from the package
root. `docs.md` covers instruction coverage, quotes, transfer hooks, and
delegates.

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
- `claimable_fees` and `claimable_rewards`, the previews behind
  `getClaimableFees` and the claim builders, plus `ineligible_reward_amount`
- `unlocked_liquidity_for_withdraw` and `bps_removal_parameters`, the vesting
  unlock behind `removeLiquidityByBps`

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
make check   # prettier, tsc, rustfmt, clippy, IDL diff
make test    # vitest and cargo test
```

`make help` lists the individual targets. Cargo targets pass `--locked`.

CI: `.github/workflows/sdk.yml` runs the TypeScript checks, with the LiteSVM
suite on `ubuntu-24.04-arm` because x86_64 LiteSVM's SBF JIT corrupts Node.
`.github/workflows/commons.yml` runs `cargo fmt`, `clippy --locked`, and
`cargo test --locked`.

`tests/fixtures/dlmm_pro.so` is dlmm-pro release 0.1.0 (`dc65a03`) and
`tests/fixtures/access_registry.so` is access-registry `d542263`, both built
with `--features local`, which stubs the admin check. Both suites read
`DLMM_PRO_SO_PATH`; the Rust suite also reads `ACCESS_REGISTRY_SO_PATH`.
