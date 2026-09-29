import { BN, type IdlTypes } from "@coral-xyz/anchor";
import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import type { LiteSVM } from "litesvm";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  defaultDynamicPoolParameters,
  encodeFixedBaseFeeData,
  OperatorPermission,
} from "../../src";
import type { DlmmPro } from "../../src/idl/dlmm-pro/dlmm_pro";
import {
  createDynamicConfig as createDynamicConfigTx,
  createStaticConfig as createStaticConfigTx,
} from "./operator";

export {
  closeConfig,
  createWhitelistOperator,
  setPoolStatus,
  updatePartnerFee,
} from "./operator";

type StaticConfigParameters = IdlTypes<DlmmPro>["staticConfigParameters"];
type DynamicConfigParameters = IdlTypes<DlmmPro>["dynamicConfigParameters"];

export function randomID(): BN {
  return new BN(Math.floor(Math.random() * 1_000_000_000));
}

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

export async function createStaticConfig(
  svm: LiteSVM,
  connection: Connection,
  operator: Keypair,
  payer: Keypair,
  index: BN,
  args: StaticConfigParameters = defaultStaticConfigArgs(),
): Promise<PublicKey> {
  return createStaticConfigTx(svm, connection, operator, payer, index, args);
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
  return createDynamicConfigTx(
    svm,
    connection,
    operator,
    payer,
    index,
    poolCreatorAuthority,
    args,
  );
}

export { defaultDynamicPoolParameters };
