# DLMM Pro SDK

TypeScript client for [DLMM Pro](https://github.com/MeteoraAg/dlmm-pro) release `0.1.0`.

Program ID: `dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n` (devnet).
Access registry: `regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`.

```
src/            @meteora-ag/dlmm-pro-sdk
src/idl/        IDL the package ships
tests/fixtures/ LiteSVM program binaries
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

## Develop

Node 22 and pnpm.

```bash
pnpm install
make check   # prettier and tsc
make test    # vitest
```

`make help` lists the individual targets.

CI: `.github/workflows/sdk.yml` runs the checks, with the LiteSVM suite on
`ubuntu-24.04-arm` because x86_64 LiteSVM's SBF JIT corrupts Node.

`tests/fixtures/dlmm_pro.so` is dlmm-pro release 0.1.0 (`dc65a03`) and
`tests/fixtures/access_registry.so` is access-registry `d542263`, both built
with `--features local`, which stubs the admin check. The suite reads
`DLMM_PRO_SO_PATH`.
