/**
 * Test-only builders for the external access-registry program, which owns
 * TokenBadge. Creating and closing registry operators and badges is not part
 * of the published client, so the LiteSVM suite builds those transactions here.
 *
 * `tests/fixtures/access_registry.so` is built from
 * https://github.com/MeteoraAg/access-registry with:
 *
 *   anchor build --ignore-keys -- --features local
 *
 * The `local` feature drops the hardcoded admin check so tests can create
 * operators, mirroring how dlmm-pro is built for tests.
 */
import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import type { LiteSVM } from "litesvm";
import { PoolError } from "../../src/errors";
import { createAccessRegistryProgram } from "../../src/helpers/create_program";
import {
  deriveAccessRegistryOperator,
  deriveTokenBadge,
  permissionBitmask,
} from "../../src/helpers";
import { assertU8 } from "../../src/helpers/validation";
import type { AccessRegistryOperatorPermission } from "../../src/types";
import { ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT } from "./constants";
import { sendTransaction } from "./svm";

export { deriveAccessRegistryOperator, deriveTokenBadge };

export async function createAccessRegistryOperator(
  svm: LiteSVM,
  connection: Connection,
  admin: Keypair,
  whitelistedAddress: PublicKey,
  permissions: AccessRegistryOperatorPermission[],
): Promise<PublicKey> {
  const permission = permissionBitmask(
    permissions,
    ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT,
  );
  if (permission.isZero()) {
    throw PoolError.invalidPermission();
  }
  const operator = deriveAccessRegistryOperator(whitelistedAddress);
  const tx = await createAccessRegistryProgram(connection)
    .methods.createOperatorAccount(permission)
    .accountsPartial({
      operator,
      whitelistedAddress,
      signer: admin.publicKey,
      payer: admin.publicKey,
    })
    .transaction();
  tx.feePayer = admin.publicKey;
  sendTransaction(svm, tx, [admin]);
  return operator;
}

export async function createTokenBadge(
  svm: LiteSVM,
  connection: Connection,
  args: {
    tokenMint: PublicKey;
    signer: Keypair;
    payer: Keypair;
    mintScore?: number;
  },
): Promise<PublicKey> {
  const mintScore = args.mintScore ?? 0;
  assertU8(mintScore);
  const tokenBadge = deriveTokenBadge(args.tokenMint);
  const tx = await createAccessRegistryProgram(connection)
    .methods.createTokenBadge(mintScore)
    .accountsPartial({
      tokenBadge,
      tokenMint: args.tokenMint,
      operator: deriveAccessRegistryOperator(args.signer.publicKey),
      signer: args.signer.publicKey,
      payer: args.payer.publicKey,
    })
    .transaction();
  tx.feePayer = args.payer.publicKey;
  const signers = args.signer.publicKey.equals(args.payer.publicKey)
    ? [args.signer]
    : [args.payer, args.signer];
  sendTransaction(svm, tx, signers);
  return tokenBadge;
}

export async function closeTokenBadge(
  svm: LiteSVM,
  connection: Connection,
  args: {
    tokenBadge: PublicKey;
    signer: Keypair;
    rentReceiver: PublicKey;
  },
): Promise<void> {
  if (args.tokenBadge.equals(PublicKey.default)) {
    throw PoolError.invalidAccount();
  }
  const tx = await createAccessRegistryProgram(connection)
    .methods.closeTokenBadge()
    .accountsPartial({
      tokenBadge: args.tokenBadge,
      operator: deriveAccessRegistryOperator(args.signer.publicKey),
      signer: args.signer.publicKey,
      rentReceiver: args.rentReceiver,
    })
    .transaction();
  tx.feePayer = args.signer.publicKey;
  sendTransaction(svm, tx, [args.signer]);
}
