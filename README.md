# DLMM Pro SDK

TypeScript SDK for the [Meteora DLMM Pro](https://github.com/MeteoraAg/dlmm-pro)
program, release 0.1.0: pool creation, quotes and swaps, multi-range
positions, limit orders, and liquidity-mining rewards.

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

const connection = new Connection("https://api.devnet.solana.com");
const client = DlmmProClient.create(connection); // commitment "confirmed"
```

`client.pool`, `client.position`, `client.limitOrder`, and `client.reward`
build unsigned transactions with the fee payer set; `client.state` and
`client.accessRegistry` read accounts. Builders resolve Token-2022
transfer-hook accounts and the pool's bitmap extension when you omit them,
and the limit-order builders derive their tick arrays. Operator and admin
instructions are not wrapped; build them with `client.program.methods`.

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
  userTokenIn: userTokenX,
  userTokenOut: userTokenY,
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
  userTokenX,
  userTokenY,
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
  userTokenX,
  userTokenY,
  bitmap: claimable.bitmap,
  tickRanges: claimable.tickRanges,
});
await sendAndConfirmTransaction(connection, tx, [owner]);
```

## Program addresses

- DLMM Pro: `dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n` (devnet)
- Access registry: `regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`

The IDLs are exported as `DlmmProIDL` and `AccessRegistryIDL`, and as JSON
from `@meteora-ag/dlmm-pro-sdk/idl/dlmm-pro` and
`@meteora-ag/dlmm-pro-sdk/idl/access-registry`.

## Development

Node 22 and pnpm. The tests run against committed program binaries in
LiteSVM.

```bash
pnpm install
pnpm format     # prettier --check
pnpm typecheck
pnpm test
pnpm build
```

## License

This SDK is released under the [MIT License](./LICENSE). The on-chain DLMM
Pro program is not covered by this license.
