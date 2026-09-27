import type {
  AccountMeta,
  Commitment,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import BN from "bn.js";
import { PoolError } from "../errors";
import type { RemainingAccountsInfo } from "../types";

export type HookKey =
  | "transferHookX"
  | "transferHookY"
  | "transferHookReferral"
  | "transferHookReward";

export const LIQUIDITY_HOOKS = ["transferHookX", "transferHookY"] as const;
export const SWAP_HOOKS = [
  "transferHookX",
  "transferHookY",
  "transferHookReferral",
] as const;
export const REWARD_HOOKS = ["transferHookReward"] as const;

const HOOK_ORDER: readonly HookKey[] = [
  "transferHookX",
  "transferHookY",
  "transferHookReferral",
  "transferHookReward",
];

const HOOK_TYPES = {
  transferHookX: { transferHookX: {} },
  transferHookY: { transferHookY: {} },
  transferHookReferral: { transferHookReferral: {} },
  transferHookReward: { transferHookReward: {} },
} as const;

export function remainingAccountsFromHooks(
  hooks: Partial<Record<HookKey, AccountMeta[] | undefined>>,
  allowed: readonly HookKey[] = HOOK_ORDER,
): {
  remainingAccountsInfo: RemainingAccountsInfo;
  remainingAccounts: AccountMeta[];
} {
  const slices: RemainingAccountsInfo["slices"] = [];
  const remainingAccounts: AccountMeta[] = [];
  const accepted = new Set<HookKey>(allowed);

  for (const key of HOOK_ORDER) {
    const accounts = hooks[key];
    if (!accounts || accounts.length === 0) {
      continue;
    }
    if (!accepted.has(key)) {
      throw PoolError.invalidRemainingAccountSlice();
    }
    if (accounts.length > 255) {
      throw PoolError.invalidRemainingAccountSlice();
    }
    slices.push({ accountsType: HOOK_TYPES[key], length: accounts.length });
    remainingAccounts.push(...accounts);
  }

  return {
    remainingAccountsInfo: { slices },
    remainingAccounts,
  };
}

export type TransferHookLeg = {
  mint: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: BN;
};

/**
 * Caller-supplied hook metas only. Omitted arrays are not resolved from the
 * mint; that resolution is added with the transfer-hook helper.
 */
export function resolveInstructionHooks(
  _connection: Connection,
  _commitment: Commitment | undefined,
  allowed: readonly HookKey[],
  provided: Partial<Record<HookKey, AccountMeta[] | undefined>>,
  _legs?: Partial<Record<HookKey, TransferHookLeg | undefined>>,
): ReturnType<typeof remainingAccountsFromHooks> {
  return remainingAccountsFromHooks(provided, allowed);
}
