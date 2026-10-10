/**
 * `tests/fixtures/dlmm_pro.so` is built with the `local` feature, which drops
 * the hardcoded admin check so any wallet can create operators.
 */
import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { LiteSVM } from "litesvm";
import { PoolError } from "../../src/errors";
import { createDlmmProProgram } from "../../src/helpers/create_program";
import {
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
  const permission = permissionBitmask(permissions, OPERATOR_PERMISSION_COUNT);
  if (permission.isZero()) {
    throw PoolError.invalidPermission();
  }
  const operator = deriveOperator(whitelistedAddress);
  const tx = await createDlmmProProgram(connection)
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

export async function createStaticConfig(
  svm: LiteSVM,
  connection: Connection,
  operator: Keypair,
  payer: Keypair,
  index: BN,
  parameters: StaticConfigParameters,
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
  parameters: DynamicConfigParameters,
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

export async function closeConfig(
  svm: LiteSVM,
  connection: Connection,
  params: {
    signer: Keypair;
    rentReceiver: PublicKey;
    staticConfig?: PublicKey | null;
    dynamicConfig?: PublicKey | null;
  },
): Promise<void> {
  const tx = await createDlmmProProgram(connection)
    .methods.closeConfig()
    .accountsPartial({
      staticConfig: params.staticConfig ?? null,
      dynamicConfig: params.dynamicConfig ?? null,
      operator: deriveOperator(params.signer.publicKey),
      signer: params.signer.publicKey,
      rentReceiver: params.rentReceiver,
    })
    .transaction();
  tx.feePayer = params.signer.publicKey;
  sendTransaction(svm, tx, [params.signer]);
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

export async function updatePartnerFee(
  svm: LiteSVM,
  connection: Connection,
  args: {
    pool: PublicKey;
    signer: Keypair;
    partnerFeeBps: number;
  },
): Promise<void> {
  const tx = await createDlmmProProgram(connection)
    .methods.updatePartnerFee(args.partnerFeeBps)
    .accountsPartial({
      pool: args.pool,
      operator: deriveOperator(args.signer.publicKey),
      signer: args.signer.publicKey,
    })
    .transaction();
  tx.feePayer = args.signer.publicKey;
  sendTransaction(svm, tx, [args.signer]);
}
