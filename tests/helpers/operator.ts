/**
 * The SDK does not wrap operator instructions, so the suite builds them here.
 * `tests/fixtures/dlmm_pro.so` is built with the `local` feature, which drops
 * the hardcoded admin check so any wallet can create operators.
 */
import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type { LiteSVM } from "litesvm";
import {
  createDlmmProProgram,
  deriveDynamicConfig,
  deriveOperator,
  deriveStaticConfig,
  permissionBitmask,
} from "../../src/helpers";
import type {
  DynamicConfigParameters,
  OperatorPermission,
  StaticConfigParameters,
} from "../../src";
import { OPERATOR_PERMISSION_COUNT } from "./constants";
import { defaultStaticConfigArgs } from "./setup";
import { sendTransaction } from "./svm";

function operatorSigners(operator: Keypair, payer: Keypair): Keypair[] {
  return operator.publicKey.equals(payer.publicKey)
    ? [operator]
    : [payer, operator];
}

export async function createWhitelistOperator(
  svm: LiteSVM,
  connection: Connection,
  admin: Keypair,
  whitelistedAddress: PublicKey,
  permissions: OperatorPermission[],
): Promise<PublicKey> {
  const operator = deriveOperator(whitelistedAddress);
  const tx = await createDlmmProProgram(connection)
    .methods.createOperatorAccount(
      new BN(permissionBitmask(permissions, OPERATOR_PERMISSION_COUNT)),
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

export async function createStaticConfig(
  svm: LiteSVM,
  connection: Connection,
  operator: Keypair,
  payer: Keypair,
  index: BN,
  parameters: StaticConfigParameters = defaultStaticConfigArgs(),
): Promise<PublicKey> {
  const config = deriveStaticConfig(index);
  const tx = await createDlmmProProgram(connection)
    .methods.createStaticConfig(index, parameters)
    .accountsPartial({
      config,
      operator: deriveOperator(operator.publicKey),
      signer: operator.publicKey,
      payer: payer.publicKey,
    })
    .transaction();
  tx.feePayer = payer.publicKey;
  sendTransaction(svm, tx, operatorSigners(operator, payer));
  return config;
}

export async function createDynamicConfig(
  svm: LiteSVM,
  connection: Connection,
  operator: Keypair,
  payer: Keypair,
  index: BN,
  poolCreatorAuthority: PublicKey,
  parameters: DynamicConfigParameters = {
    permission: new BN(0),
    partnerFeeBps: 0,
  },
): Promise<PublicKey> {
  const config = deriveDynamicConfig(poolCreatorAuthority, index);
  const tx = await createDlmmProProgram(connection)
    .methods.createDynamicConfig(index, parameters)
    .accountsPartial({
      config,
      operator: deriveOperator(operator.publicKey),
      signer: operator.publicKey,
      payer: payer.publicKey,
      poolCreatorAuthority,
    })
    .transaction();
  tx.feePayer = payer.publicKey;
  sendTransaction(svm, tx, operatorSigners(operator, payer));
  return config;
}

export async function setPoolStatus(
  svm: LiteSVM,
  connection: Connection,
  args: {
    pool: PublicKey;
    signer: Keypair;
    status: number;
  },
): Promise<void> {
  const tx = await createDlmmProProgram(connection)
    .methods.setPoolStatus(args.status)
    .accountsPartial({
      pool: args.pool,
      operator: deriveOperator(args.signer.publicKey),
      signer: args.signer.publicKey,
    })
    .transaction();
  tx.feePayer = args.signer.publicKey;
  sendTransaction(svm, tx, [args.signer]);
}
