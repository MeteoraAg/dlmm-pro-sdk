import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";
import { PoolError } from "../errors";
import { TokenProgramFlags } from "../types";

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

/**
 * A delegate may only withdraw to the owner's associated token account;
 * the owner may use any token account.
 */
export function assertDelegateReceiver(args: {
  owner: PublicKey;
  signer: PublicKey;
  tokenAccount: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}): void {
  if (args.signer.equals(args.owner)) {
    return;
  }
  const ata = getAssociatedTokenAddressSync(
    args.mint,
    args.owner,
    true,
    args.tokenProgram,
  );
  if (!args.tokenAccount.equals(ata)) {
    throw PoolError.incorrectATA();
  }
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
  const accountInfo = await connection.getAccountInfo(tokenMint, commitment);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${tokenMint.toBase58()}`);
  }
  if (
    accountInfo.owner.equals(TOKEN_PROGRAM_ID) ||
    accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    return accountInfo.owner;
  }
  throw new Error(
    `Mint ${tokenMint.toBase58()} is not owned by a supported token program`,
  );
}
