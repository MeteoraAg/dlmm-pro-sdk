/**
 * `tests/fixtures/dlmm_pro.so` is built with the `local` feature, which drops
 * the hardcoded admin check so any wallet can create operators.
 */
import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import BN from "bn.js";
import type { LiteSVM } from "litesvm";
import {
  MAX_PARTNER_FEE_BPS,
  MAX_TICK_SPACING,
  POOL_EXTENSION_VARIANT_COUNT,
} from "../../src/constants";
import { PoolError } from "../../src/errors";
import { createDlmmProProgram } from "../../src/helpers/create_program";
import {
  bitmaskMax,
  deriveDynamicConfig,
  deriveOperator,
  deriveStaticConfig,
  isSupportExtension,
  permissionBitmask,
  validatePoolFeeParameters,
} from "../../src/helpers";
import { assertU64 } from "../../src/helpers/validation";
import {
  tryCastActivationType,
  tryCastCollectFeeMode,
} from "../../src/math/safe_math";
import {
  DlmmProClient,
  PoolExtension,
  type DynamicConfigParameters,
  type OperatorPermission,
  type StaticConfigParameters,
} from "../../src";
import {
  DYNAMIC_CONFIG_PERMISSION_COUNT,
  OPERATOR_PERMISSION_COUNT,
  POOL_STATUS_COUNT,
} from "./constants";
import { sendTransaction } from "./svm";

function operatorSigners(operator: Keypair, payer: Keypair): Keypair[] {
  return operator.publicKey.equals(payer.publicKey)
    ? [operator]
    : [payer, operator];
}

function validateStaticConfigParameters(
  parameters: StaticConfigParameters,
): void {
  validatePoolFeeParameters(parameters.poolFees);
  if (
    !Number.isInteger(parameters.tickSpacing) ||
    parameters.tickSpacing <= 0 ||
    parameters.tickSpacing > MAX_TICK_SPACING
  ) {
    throw PoolError.invalidParameters();
  }
  tryCastCollectFeeMode(parameters.collectFeeMode);
  try {
    tryCastActivationType(parameters.activationType);
  } catch {
    throw PoolError.invalidActivationType();
  }
  const extensionMax = (1 << POOL_EXTENSION_VARIANT_COUNT) - 1;
  if (
    !Number.isInteger(parameters.extensions) ||
    parameters.extensions < 0 ||
    parameters.extensions > extensionMax ||
    isSupportExtension(parameters.extensions, PoolExtension.ActivationAccess)
  ) {
    throw PoolError.invalidParameters();
  }
}

function validateDynamicConfigParameters(
  parameters: DynamicConfigParameters,
  poolCreatorAuthority: PublicKey,
): void {
  if (
    parameters.permission.isNeg() ||
    parameters.permission.gt(bitmaskMax(DYNAMIC_CONFIG_PERMISSION_COUNT))
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    !Number.isInteger(parameters.partnerFeeBps) ||
    parameters.partnerFeeBps < 0 ||
    parameters.partnerFeeBps > MAX_PARTNER_FEE_BPS
  ) {
    throw PoolError.invalidParameters();
  }
  if (poolCreatorAuthority.equals(PublicKey.default)) {
    throw PoolError.invalidParameters();
  }
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
  assertU64(index);
  validateStaticConfigParameters(parameters);
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
  assertU64(index);
  validateDynamicConfigParameters(parameters, poolCreatorAuthority);
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
  const hasStatic = !!params.staticConfig;
  const hasDynamic = !!params.dynamicConfig;
  if (hasStatic === hasDynamic) {
    throw PoolError.invalidParameters();
  }
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
  const maxStatus = bitmaskMax(POOL_STATUS_COUNT).toNumber();
  if (
    !Number.isInteger(args.status) ||
    args.status < 0 ||
    args.status > maxStatus
  ) {
    throw PoolError.invalidParameters();
  }
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
  if (
    !Number.isInteger(args.partnerFeeBps) ||
    args.partnerFeeBps < 0 ||
    args.partnerFeeBps > MAX_PARTNER_FEE_BPS
  ) {
    throw PoolError.invalidParameters();
  }
  const pool = await DlmmProClient.create(connection).state.fetchPool(
    args.pool,
  );
  if (pool.poolPartner.partner.equals(PublicKey.default)) {
    throw PoolError.invalidParameters();
  }
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
