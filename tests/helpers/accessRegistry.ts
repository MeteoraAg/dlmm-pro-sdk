/**
 * Test-only builders for the external access-registry program, which owns
 * TokenBadge. Creating registry operators and badges is not part of the
 * published client, so the LiteSVM suite builds those transactions here.
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
import BN from "bn.js";
import type { LiteSVM } from "litesvm";
import {
  createAccessRegistryProgram,
  deriveOperator,
  deriveTokenBadge,
  permissionBitmask,
} from "../../src/helpers";
import { ACCESS_REGISTRY_PROGRAM_ID } from "../../src/constants";
import type { AccessRegistryOperatorPermission } from "../../src/types";
import { ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT } from "./constants";
import { sendTransaction } from "./svm";

const MINT_SCORE = 0;

export async function createAccessRegistryOperator(
  svm: LiteSVM,
  connection: Connection,
  admin: Keypair,
  whitelistedAddress: PublicKey,
  permissions: AccessRegistryOperatorPermission[],
): Promise<PublicKey> {
  const operator = deriveOperator(
    whitelistedAddress,
    ACCESS_REGISTRY_PROGRAM_ID,
  );
  const tx = await createAccessRegistryProgram(connection)
    .methods.createOperatorAccount(
      new BN(
        permissionBitmask(
          permissions,
          ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT,
        ),
      ),
    )
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
  },
): Promise<PublicKey> {
  const tokenBadge = deriveTokenBadge(args.tokenMint);
  const tx = await createAccessRegistryProgram(connection)
    .methods.createTokenBadge(MINT_SCORE)
    .accountsPartial({
      tokenBadge,
      tokenMint: args.tokenMint,
      operator: deriveOperator(
        args.signer.publicKey,
        ACCESS_REGISTRY_PROGRAM_ID,
      ),
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
