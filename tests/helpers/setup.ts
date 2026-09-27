/**
 * Fixture builders for admin and operator instructions. They go through
 * `DlmmProClient.operator` so the LiteSVM suite covers those wrappers.
 *
 * `tests/fixtures/dlmm_pro.so` is built with the `local` feature, which drops
 * the hardcoded admin check so any wallet can create operators.
 */
import { BN, type IdlTypes } from "@coral-xyz/anchor";
import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import type { LiteSVM } from "litesvm";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  defaultDynamicPoolParameters,
  DlmmProClient,
  encodeFixedBaseFeeData,
  OperatorPermission,
} from "../../src";
import type { DlmmPro } from "../../src/idl/dlmm-pro/dlmm_pro";
import { sendTransaction } from "./svm";

type StaticConfigParameters = IdlTypes<DlmmPro>["staticConfigParameters"];
type DynamicConfigParameters = IdlTypes<DlmmPro>["dynamicConfigParameters"];

export function randomID(): BN {
  return new BN(Math.floor(Math.random() * 1_000_000_000));
}

/** Bitmask of enum variants, used for every `permission` and `status` field. */
export function bitmask(flags: readonly number[]): number {
  return flags.reduce((mask, flag) => mask | (1 << flag), 0);
}

export function allOperatorPermissions(): OperatorPermission[] {
  return [
    OperatorPermission.CreateConfigKey,
    OperatorPermission.RemoveConfigKey,
    OperatorPermission.SetPoolStatus,
    OperatorPermission.InitializeReward,
    OperatorPermission.UpdateRewardAuthority,
    OperatorPermission.UpdatePartnerFee,
  ];
}

export function defaultStaticConfigArgs(
  poolCreatorAuthority: PublicKey | null = PublicKey.default,
): StaticConfigParameters {
  return {
    poolFees: {
      baseFeeParameter: {
        baseFeeMode: BaseFeeMode.Fixed,
        data: encodeFixedBaseFeeData(1_000_000),
      },
      dynamicFeeParameter: null,
    },
    tickSpacing: 1,
    collectFeeMode: CollectFeeMode.OutputToken,
    activationType: ActivationType.Timestamp,
    extensions: 0,
    poolCreatorAuthority,
  };
}

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
  const client = DlmmProClient.create(connection);
  const { tx, operator } = await client.operator.createOperatorAccount({
    whitelistedAddress,
    signer: admin.publicKey,
    payer: admin.publicKey,
    permissions,
  });
  sendTransaction(svm, tx, [admin]);
  return operator;
}

export async function createStaticConfig(
  svm: LiteSVM,
  connection: Connection,
  operator: Keypair,
  payer: Keypair,
  index: BN,
  args: StaticConfigParameters = defaultStaticConfigArgs(),
): Promise<PublicKey> {
  const client = DlmmProClient.create(connection);
  const { tx, config } = await client.operator.createStaticConfig({
    index,
    parameters: args,
    signer: operator.publicKey,
    payer: payer.publicKey,
  });
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
  args: DynamicConfigParameters = {
    permission: new BN(0),
    partnerFeeBps: 0,
  },
): Promise<PublicKey> {
  const client = DlmmProClient.create(connection);
  const { tx, config } = await client.operator.createDynamicConfig({
    index,
    poolCreatorAuthority,
    parameters: args,
    signer: operator.publicKey,
    payer: payer.publicKey,
  });
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
  const client = DlmmProClient.create(connection);
  const { tx } = await client.operator.setPoolStatus({
    pool: args.pool,
    signer: args.signer.publicKey,
    status: args.status,
  });
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
  const client = DlmmProClient.create(connection);
  const { tx } = await client.operator.updatePartnerFee({
    pool: args.pool,
    signer: args.signer.publicKey,
    partnerFeeBps: args.partnerFeeBps,
  });
  sendTransaction(svm, tx, [args.signer]);
}

export { defaultDynamicPoolParameters };
