import {
  createTransferCheckedInstruction,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  addExtraAccountMetasForExecute,
} from "@solana/spl-token";
import {
  type AccountMeta,
  type Commitment,
  type Connection,
  PublicKey,
} from "@solana/web3.js";
import { readTransferFeeMint } from "./account_reads";
import { deriveReserve } from "./pda";
import { remainingAccountsFromHooks, type HookKey } from "./remaining_accounts";

export type TransferHookLeg = {
  mint: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
};

/** Reserve PDAs and the X/Y legs of an instruction moving both tokens between the user and the reserves. */
export function reserveTransferLegs(args: {
  pool: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  userTokenX: PublicKey;
  userTokenY: PublicKey;
  /** The user for deposits, the pool authority for withdrawals. */
  authority: PublicKey;
  deposit: boolean;
  programId: PublicKey;
}): {
  reserveX: PublicKey;
  reserveY: PublicKey;
  transferHookX: TransferHookLeg;
  transferHookY: TransferHookLeg;
} {
  const reserveX = deriveReserve(args.tokenXMint, args.pool, args.programId);
  const reserveY = deriveReserve(args.tokenYMint, args.pool, args.programId);
  const leg = (
    mint: PublicKey,
    user: PublicKey,
    reserve: PublicKey,
  ): TransferHookLeg => ({
    mint,
    source: args.deposit ? user : reserve,
    destination: args.deposit ? reserve : user,
    authority: args.authority,
  });
  return {
    reserveX,
    reserveY,
    transferHookX: leg(args.tokenXMint, args.userTokenX, reserveX),
    transferHookY: leg(args.tokenYMint, args.userTokenY, reserveY),
  };
}

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
  const mint = await readTransferFeeMint(connection, leg.mint, commitment);
  if (!mint) {
    return [];
  }
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
