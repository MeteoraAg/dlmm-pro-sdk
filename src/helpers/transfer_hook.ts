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
import { readMintAccount } from "./account_reads";
import { remainingAccountsFromHooks, type HookKey } from "./remaining_accounts";

export type TransferHookLeg = {
  mint: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
};

/**
 * Extra account metas a Token-2022 transfer of `mint` needs. Legacy SPL mints
 * and Token-2022 mints without a transfer hook return an empty list.
 *
 * The metas are resolved for a zero amount, so a hook whose extra accounts
 * depend on the amount needs them passed explicitly. The returned metas are
 * everything after source, mint, destination, and authority — the same slice
 * the program reads from `RemainingAccountsInfo`.
 */
export async function getExtraAccountMetasForTransferHook(
  connection: Connection,
  leg: TransferHookLeg,
  commitment?: Commitment,
): Promise<AccountMeta[]> {
  const mintAccount = await readMintAccount(connection, leg.mint, commitment);
  if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) {
    return [];
  }

  const mint = unpackMint(leg.mint, mintAccount, mintAccount.owner);
  const hook = getTransferHook(mint);
  if (!hook || hook.programId.equals(PublicKey.default)) {
    return [];
  }

  const transfer = createTransferCheckedInstruction(
    leg.source,
    leg.mint,
    leg.destination,
    leg.authority,
    0n,
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
    0n,
    commitment,
  );
  return transfer.keys.slice(4);
}

/**
 * Pack hook metas for one instruction. A `metas` array is used as-is, even
 * when empty; otherwise the metas are resolved from `leg`. Keys with neither
 * are skipped.
 */
export async function resolveInstructionHooks(
  connection: Connection,
  commitment: Commitment | undefined,
  hooks: Partial<
    Record<HookKey, { metas?: AccountMeta[]; leg?: TransferHookLeg }>
  >,
) {
  const resolved: Partial<Record<HookKey, AccountMeta[]>> = {};
  await Promise.all(
    Object.entries(hooks).map(async ([key, { metas, leg }]) => {
      resolved[key as HookKey] =
        metas ??
        (leg &&
          (await getExtraAccountMetasForTransferHook(
            connection,
            leg,
            commitment,
          )));
    }),
  );
  return remainingAccountsFromHooks(resolved);
}
