/**
 * Builders for the external access-registry program, which owns TokenBadge.
 * They go through `DlmmProClient.accessRegistry` so the LiteSVM suite covers
 * badge and registry-operator writes.
 *
 * `tests/fixtures/access_registry.so` is built from
 * https://github.com/MeteoraAg/access-registry with:
 *
 *   anchor build --ignore-keys -- --features local
 *
 * The `local` feature drops the hardcoded admin check so tests can create
 * operators, mirroring how dlmm-pro is built for tests.
 */
import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { LiteSVM } from "litesvm";
import {
  deriveAccessRegistryOperator,
  deriveTokenBadge,
  DlmmProClient,
  type AccessRegistryOperatorPermission,
} from "../../src";
import { sendTransaction } from "./svm";

export { deriveAccessRegistryOperator, deriveTokenBadge };

export async function createAccessRegistryOperator(
  svm: LiteSVM,
  connection: Connection,
  admin: Keypair,
  whitelistedAddress: PublicKey,
  permissions: AccessRegistryOperatorPermission[],
): Promise<PublicKey> {
  const client = DlmmProClient.create(connection);
  const { tx, operator } = await client.accessRegistry.createOperatorAccount({
    whitelistedAddress,
    signer: admin.publicKey,
    payer: admin.publicKey,
    permissions,
  });
  sendTransaction(svm, tx, [admin]);
  return operator;
}

export async function createTokenBadge(
  svm: LiteSVM,
  connection: Connection,
  args: {
    tokenMint: PublicKey;
    /** Access-registry operator keypair with the CreateTokenBadge permission. */
    signer: Keypair;
    payer: Keypair;
    mintScore?: number;
  },
): Promise<PublicKey> {
  const client = DlmmProClient.create(connection);
  const { tx, tokenBadge } = await client.accessRegistry.createTokenBadge({
    tokenMint: args.tokenMint,
    signer: args.signer.publicKey,
    payer: args.payer.publicKey,
    mintScore: args.mintScore,
  });
  const signers = args.signer.publicKey.equals(args.payer.publicKey)
    ? [args.signer]
    : [args.payer, args.signer];
  sendTransaction(svm, tx, signers);
  return tokenBadge;
}
