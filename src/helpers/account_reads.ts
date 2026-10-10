import {
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  unpackMint,
  type Mint,
} from "@solana/spl-token";
import { type Commitment, type Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PoolError } from "../errors";

export async function readClock(
  connection: Connection,
  commitment?: Commitment,
): Promise<{ slot: BN; timestamp: BN; epoch: bigint }> {
  const epochInfo = await connection.getEpochInfo(commitment);
  const blockTime = await connection.getBlockTime(epochInfo.absoluteSlot);
  if (blockTime === null) {
    throw PoolError.undeterminedError();
  }
  return {
    slot: new BN(epochInfo.absoluteSlot),
    timestamp: new BN(blockTime),
    epoch: BigInt(epochInfo.epoch),
  };
}

/** Unpacked Token-2022 mint, or `null` when the mint cannot charge a transfer fee. */
export async function readTransferFeeMint(
  connection: Connection,
  mint: PublicKey,
  commitment?: Commitment,
): Promise<Mint | null> {
  const info = await connection.getAccountInfo(mint, commitment);
  if (!info) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  if (info.owner.equals(TOKEN_PROGRAM_ID)) {
    return null;
  }
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `Mint ${mint.toBase58()} is not owned by a supported token program`,
    );
  }
  return unpackMint(mint, info, info.owner);
}

export async function readTokenAccountAmount(
  connection: Connection,
  address: PublicKey,
  tokenProgram: PublicKey,
  commitment?: Commitment,
): Promise<BN> {
  try {
    const account = await getAccount(
      connection,
      address,
      commitment,
      tokenProgram,
    );
    return new BN(account.amount.toString());
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      return new BN(0);
    }
    throw error;
  }
}
