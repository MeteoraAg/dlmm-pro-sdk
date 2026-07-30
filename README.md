# DLMM Pro SDK

A TypeScript SDK for interacting with Meteora's DLMM Pro

## Overview

This SDK provides a set of tools and methods to interact with the [Meteora DLMM Pro](https://github.com/MeteoraAg/dlmm-pro).

For detailed technical documentation, please refer to the [DLMM Pro SDK Documentation](https://github.com/MeteoraAg/dlmm-pro-sdk/blob/main/docs.md).

## Installation

```bash
pnpm install @meteora-ag/dlmm-pro-sdk
# or
yarn add @meteora-ag/dlmm-pro-sdk
```

### Initialization

```typescript
import { Connection } from "@solana/web3.js";
import { DlmmPro } from "@meteora-ag/dlmm-pro-sdk";

// Initialize a connection to the Solana network
const connection = new Connection("https://api.mainnet-beta.solana.com");

// Create a new instance of the DLMM Pro SDK
const dlmmPro = new DlmmPro(connection, 'confirmed');
```

### Test

```
pnpm install
pnpm test
```

## Deployments

- Mainnet-beta: dLmmthrtCtGNx512fjkTsWx7otWdv1SKrbQDR8dbffA
- Devnet: dLmmthrtCtGNx512fjkTsWx7otWdv1SKrbQDR8dbffA

## Faucets

https://faucet.raccoons.dev/
