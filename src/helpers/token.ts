import {
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  type Commitment,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { PoolError } from "../errors";
import { TokenProgramFlags } from "../types";
import { readMintAccount } from "./account_reads";

export function findNftAccount(
  nftMint: PublicKey,
  owner: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(
    nftMint,
    owner,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
}

export function getTokenProgram(tokenProgramFlag: number): PublicKey {
  switch (tokenProgramFlag) {
    case TokenProgramFlags.TokenProgram:
      return TOKEN_PROGRAM_ID;
    case TokenProgramFlags.TokenProgram2022:
      return TOKEN_2022_PROGRAM_ID;
    default:
      throw PoolError.typeCastFailed();
  }
}

/** Mint stored in the first 32 bytes of an SPL or Token-2022 token account. */
export async function readTokenAccountMint(
  connection: Connection,
  address: PublicKey,
  commitment: Commitment,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(address, commitment);
  if (!info || info.data.length < 32) {
    throw PoolError.invalidAccount();
  }
  return new PublicKey(info.data.subarray(0, 32));
}

export async function resolveTokenProgram(
  connection: Connection,
  tokenMint: PublicKey,
  commitment?: Commitment,
): Promise<PublicKey> {
  return (await readMintAccount(connection, tokenMint, commitment)).owner;
}

export function isNativeSol(mint: PublicKey): boolean {
  return mint.equals(NATIVE_MINT);
}

/** Transfer lamports into an existing wrapped SOL account and sync its balance. */
export function wrapSOLInstruction(
  from: PublicKey,
  to: PublicKey,
  amount: bigint,
): TransactionInstruction[] {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: amount,
    }),
    createSyncNativeInstruction(to, TOKEN_PROGRAM_ID),
  ];
}

/** Close the owner's wrapped SOL account and send the lamports to receiver. */
export function unwrapSOLInstruction(
  owner: PublicKey,
  receiver: PublicKey = owner,
): TransactionInstruction {
  return createCloseAccountInstruction(
    getAssociatedTokenAddressSync(NATIVE_MINT, owner, true, TOKEN_PROGRAM_ID),
    receiver,
    owner,
    [],
    TOKEN_PROGRAM_ID,
  );
}
