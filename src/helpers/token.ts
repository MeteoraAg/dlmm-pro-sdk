import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";
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
