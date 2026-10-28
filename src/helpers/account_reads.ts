import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
  type Mint,
} from "@solana/spl-token";
import {
  type AccountInfo,
  type Commitment,
  type Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import BN from "bn.js";

/** Slot, unix timestamp, and epoch from the Clock sysvar the program reads. */
export async function readClock(
  connection: Connection,
  commitment?: Commitment,
): Promise<{ slot: BN; timestamp: BN; epoch: bigint }> {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, commitment);
  if (!info) {
    throw new Error("Clock sysvar not found");
  }
  // slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64,
  // unix_timestamp i64
  return {
    slot: new BN(info.data.readBigUInt64LE(0).toString()),
    timestamp: new BN(info.data.readBigInt64LE(32).toString()),
    epoch: info.data.readBigUInt64LE(16),
  };
}

/** The mint's account; throws unless the SPL Token or Token-2022 program owns it. */
export async function readMintAccount(
  connection: Connection,
  mint: PublicKey,
  commitment?: Commitment,
): Promise<AccountInfo<Buffer>> {
  const info = await connection.getAccountInfo(mint, commitment);
  if (!info) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  if (
    !info.owner.equals(TOKEN_PROGRAM_ID) &&
    !info.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error(
      `Mint ${mint.toBase58()} is not owned by a supported token program`,
    );
  }
  return info;
}

/** Unpacked Token-2022 mint, or `null` for an SPL Token mint, which has no transfer fee. */
export async function readTransferFeeMint(
  connection: Connection,
  mint: PublicKey,
  commitment?: Commitment,
): Promise<Mint | null> {
  const info = await readMintAccount(connection, mint, commitment);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? unpackMint(mint, info, info.owner)
    : null;
}
