import { PublicKey } from "@solana/web3.js";
import DlmmProIDL from "./idl/dlmm_pro.json";

function idlConstant(name: string): string {
  const constant = DlmmProIDL.constants.find((c) => c.name === name);
  if (!constant) {
    throw new Error(`IDL constant not found: ${name}`);
  }
  return constant.value;
}

export const DLMM_PRO_PROGRAM_ID = new PublicKey(DlmmProIDL.address);

// PDA seed prefixes
export const OPERATOR_PREFIX = "operator";
export const STATIC_CONFIG_PREFIX = "s_config";
export const DYNAMIC_CONFIG_PREFIX = "d_config";
export const TOKEN_BADGE_PREFIX = "token_badge";
export const POOL_PREFIX = "pool";
export const LAUNCH_POOL_PREFIX = "l_pool";
export const POOL_AUTHORITY_PREFIX = "pool_auth";
export const RESERVE_PREFIX = "reserve";
export const TICK_ARRAY_BITMAP_EXTENSION_PREFIX = "bitmap";
export const ORACLE_PREFIX = "oracle";
export const TICK_ARRAY_PREFIX = "tick_array";
export const POSITION_PREFIX = "position";
export const LIMIT_ORDER_PREFIX = "limit_order";
export const REWARD_VAULT_PREFIX = "reward";

export const BITMAP_SIZE = Number(idlConstant("BITMAP_SIZE"));
export const MAX_TICKS_PER_ARRAY = Number(
  idlConstant("MAX_TICKS_PER_ARRAY_U64"),
);
export const NUM_REWARDS = Number(idlConstant("NUM_REWARDS_U64"));

export const NUMBER_OF_ACTIVATION_MODES = 2;

export enum PoolExtension {
  LiquidityMining = 0,
  ActivationAccess = 1,
}
