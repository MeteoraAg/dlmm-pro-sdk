# DLMM Pro SDK

TypeScript SDK and Rust crate for the Meteora DLMM Pro program.

The function reference is in [docs.md](docs.md).

## Installation

```bash
pnpm add @meteora-ag/dlmm-pro-sdk
# or
npm install @meteora-ag/dlmm-pro-sdk
```

## Client

```typescript
import { Connection } from "@solana/web3.js";
import { DlmmProClient } from "@meteora-ag/dlmm-pro-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const client = new DlmmProClient(connection); // commitment "confirmed"
```

`client.pool`, `client.position`, `client.limitOrder`, and `client.reward`
build unsigned transactions with the fee payer set; `client.state` reads accounts. Builders resolve Token-2022
transfer-hook accounts and the pool's bitmap extension when you omit them,
and the limit-order builders derive their tick arrays. User token accounts
default to associated token accounts, created when missing, and native SOL is
wrapped and unwrapped in the same transaction.

## Swap

```typescript
const poolState = await client.state.fetchPool(pool);
const inputAmount = new BN(1_000_000);
const { quote, tickArrays, tickArrayBitmapExtension } =
  await client.pool.quoteExactIn({
    pool,
    inputAmount,
    swapForY: true, // sell X for Y
    swapper: user.publicKey,
  });
if (!quote.amountLeft.isZero()) {
  throw new Error("Not enough liquidity for this input");
}

const { tx } = await client.pool.swap({
  pool,
  tokenXMint: poolState.tokenXMint,
  tokenYMint: poolState.tokenYMint,
  user: user.publicKey,
  swapForY: true,
  tickArrays,
  tickArrayBitmapExtension,
  parameters: {
    inputAmount,
    minimumOutputAmount: quote.transferFeeExcludedOutAmount
      .muln(9_950)
      .divn(10_000), // 0.5% slippage
  },
});
await sendAndConfirmTransaction(connection, tx, [user]);
```

## Open a position and add liquidity

```typescript
const { tickSpacing, tickCurrentId, sqrtPrice } = poolState;
const aligned = Math.floor(tickCurrentId / tickSpacing) * tickSpacing;
const tickRanges = [
  {
    tickLowerId: aligned - 10 * tickSpacing,
    tickUpperId: aligned + 10 * tickSpacing,
  },
];

const nft = Keypair.generate();
const opened = await client.position.openPosition({
  pool,
  owner: owner.publicKey,
  payer: owner.publicKey,
  nftMint: nft.publicKey,
  tickRanges,
});
await sendAndConfirmTransaction(connection, opened.tx, [owner, nft]);

const maxAmountX = new BN(1_000_000);
const maxAmountY = new BN(1_000_000);
const liquidity = getLiquidityFromAmounts({
  maxTokenX: maxAmountX,
  maxTokenY: maxAmountY,
  tickLowerId: tickRanges[0].tickLowerId,
  tickUpperId: tickRanges[0].tickUpperId,
  tickCurrentId,
  currentSqrtPrice: sqrtPrice,
});
const added = await client.position.addLiquidity({
  pool,
  nftMint: nft.publicKey,
  owner: owner.publicKey,
  signer: owner.publicKey,
  tokenXMint: poolState.tokenXMint,
  tokenYMint: poolState.tokenYMint,
  tickRanges,
  parameters: {
    maxAmountX,
    maxAmountY,
    expectedLayoutVersion: null,
    bitmap: liquidityBitmap([0]), // slot 0
    liquidities: [liquidity],
  },
});
await sendAndConfirmTransaction(connection, added.tx, [owner]);
```

`buildLiquidityShape`, `multiplierFromAmounts`, and `addLiquidityByWeight`
spread a deposit over many ranges with a Spot, Curve, BidAsk, or custom
profile; see [docs.md](docs.md#liquidity-shape-functions).

## Claim fees

```typescript
const claimable = await client.position.getClaimableFees({
  pool,
  nftMint: nft.publicKey,
});
const { tx } = await client.position.claimFee({
  pool,
  nftMint: nft.publicKey,
  owner: owner.publicKey,
  signer: owner.publicKey,
  tokenXMint: poolState.tokenXMint,
  tokenYMint: poolState.tokenYMint,
  bitmap: claimable.bitmap,
  tickRanges: claimable.tickRanges,
});
await sendAndConfirmTransaction(connection, tx, [owner]);
```

## Rust

`dlmm-pro-commons` in [commons/](commons) is for Rust integrators such as
aggregators. It is not on crates.io; depend on it from git:

```toml
[dependencies]
dlmm-pro-commons = { git = "https://github.com/MeteoraAg/dlmm-pro-sdk" }
```

It provides the `declare_program!(dlmm_pro)` types and instruction structs,
PDAs and constants, parsers for the accounts with a dynamic tail
(`DynamicPool`, `DynamicTickArray`, `DynamicOracle`, `DynamicLimitOrder`,
`DynamicPositionArray`), `quote_exact_in` with `tick_arrays_for_swap`,
Token-2022 transfer-fee and transfer-hook helpers, and `claimable_fees` and
`claimable_rewards`. `AccountDeserialize` on the `declare_program!` account
types panics on accounts with a dynamic tail; use the `Dynamic*` parsers.

```rust
use dlmm_pro_commons::*;

let pool_state = DynamicPool::deserialize(&pool_account_data)?;
// The account at derive_tick_array_bitmap_extension(pool), once the pool has one.
let extension = if pool_state.pool.is_bitmap_extension_initialized() {
    Some(deserialize_anchor_pod_account::<TickArrayBitmapExtension>(&extension_account_data)?)
} else {
    None
};
let tick_arrays =
    tick_arrays_for_swap(pool, &pool_state.pool, extension.as_ref(), swap_for_y, 3)?;
// Fetch and parse the tick arrays and both mints, then:
let quote = quote_exact_in(QuoteExactInParams { /* pool address, parsed accounts, mint data, clock */ })?;
```

## Program addresses

- DLMM Pro: `dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n`
- Access registry: `regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`

The IDLs are exported as `DlmmProIDL` and `AccessRegistryIDL`, and as JSON
from `@meteora-ag/dlmm-pro-sdk/idl/dlmm-pro` and
`@meteora-ag/dlmm-pro-sdk/idl/access-registry`.

## Development

Node 22 and pnpm; Rust per `rust-toolchain.toml`. Both test suites run
against committed program binaries in LiteSVM.

```bash
pnpm install
pnpm format     # prettier --check
pnpm typecheck
pnpm test
pnpm build

cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

## License

This SDK is released under the [MIT License](./LICENSE). The on-chain DLMM
Pro program is not covered by this license.
