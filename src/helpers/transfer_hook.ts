import {
  createTransferCheckedInstruction,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
  addExtraAccountMetasForExecute,
} from "@solana/spl-token";
import {
  type AccountMeta,
  type Commitment,
  type Connection,
  PublicKey,
} from "@solana/web3.js";
import BN from "bn.js";
import { toBigInt, tryCastU64 } from "../math";
import { remainingAccountsFromHooks, type HookKey } from "./remaining_accounts";

export type TransferHookAmount = BN | (() => Promise<BN>);

export type TransferHookLeg = {
  mint: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  /**
   * Amount the program transfers. A function is called only after the mint
   * is known to have a transfer hook, and a zero amount omits the slice
   * because the program skips that transfer.
   */
  amount: TransferHookAmount;
};

async function transferAmount(amount: TransferHookAmount): Promise<BN> {
  const value = typeof amount === "function" ? await amount() : amount;
  return tryCastU64(value);
}

/**
 * Extra account metas a Token-2022 transfer of `mint` needs. Legacy SPL mints,
 * Token-2022 mints without a transfer hook, and a zero transfer amount return
 * an empty list.
 *
 * The returned metas are everything after source, mint, destination, and
 * authority — the same slice the program reads from `RemainingAccountsInfo`.
 */
export async function getExtraAccountMetasForTransferHook(
  connection: Connection,
  leg: TransferHookLeg,
  commitment?: Commitment,
): Promise<AccountMeta[]> {
  const mintAccount = await connection.getAccountInfo(leg.mint, commitment);
  if (!mintAccount) {
    throw new Error(`Mint account not found: ${leg.mint.toBase58()}`);
  }
  if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) {
    return [];
  }
  if (!mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `Mint ${leg.mint.toBase58()} is not owned by a supported token program`,
    );
  }

  const mint = unpackMint(leg.mint, mintAccount, mintAccount.owner);
  const hook = getTransferHook(mint);
  if (!hook || hook.programId.equals(PublicKey.default)) {
    return [];
  }

  const amountBn = await transferAmount(leg.amount);
  if (amountBn.isZero()) {
    return [];
  }
  const amount = toBigInt(amountBn);
  const transfer = createTransferCheckedInstruction(
    leg.source,
    leg.mint,
    leg.destination,
    leg.authority,
    amount,
    mint.decimals,
    [],
    TOKEN_2022_PROGRAM_ID,
  );
  await addExtraAccountMetasForExecute(
    connection,
    transfer,
    hook.programId,
    leg.source,
    leg.mint,
    leg.destination,
    leg.authority,
    amount,
    commitment,
  );
  return transfer.keys.slice(4);
}

/**
 * Pack hook metas for one instruction. A caller-supplied array is used as-is.
 * An omitted array is resolved from the mint when a leg is provided.
 * A non-empty array of a slice type the instruction does not accept fails
 * here, matching the program's `InvalidRemainingAccountSlice`.
 */
export async function resolveInstructionHooks(
  connection: Connection,
  commitment: Commitment | undefined,
  allowed: readonly HookKey[],
  provided: Partial<Record<HookKey, AccountMeta[] | undefined>>,
  legs: Partial<Record<HookKey, TransferHookLeg | undefined>> = {},
): Promise<{
  remainingAccountsInfo: ReturnType<
    typeof remainingAccountsFromHooks
  >["remainingAccountsInfo"];
  remainingAccounts: AccountMeta[];
}> {
  const resolved: Partial<Record<HookKey, AccountMeta[]>> = {};
  for (const key of allowed) {
    if (provided[key] !== undefined) {
      resolved[key] = provided[key];
      continue;
    }
    const leg = legs[key];
    if (!leg) {
      continue;
    }
    resolved[key] = await getExtraAccountMetasForTransferHook(
      connection,
      leg,
      commitment,
    );
  }
  return remainingAccountsFromHooks({ ...provided, ...resolved }, allowed);
}
