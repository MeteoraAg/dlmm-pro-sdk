import {
  type Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  unpackMint,
} from "@solana/spl-token";
import { PoolError } from "../errors";
import { TokenProgramFlags } from "../types";

export async function getOrCreateATAInstruction(
  connection: Connection,
  tokenMint: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  tokenProgram: PublicKey,
  allowOwnerOffCurve = true,
): Promise<{ ataPubkey: PublicKey; ix?: TransactionInstruction }> {
  const ataPubkey = getAssociatedTokenAddressSync(
    tokenMint,
    owner,
    allowOwnerOffCurve,
    tokenProgram,
  );

  try {
    await getAccount(connection, ataPubkey, "confirmed", tokenProgram);
    return { ataPubkey };
  } catch (error) {
    if (
      !(error instanceof TokenAccountNotFoundError) &&
      !(error instanceof TokenInvalidAccountOwnerError)
    ) {
      throw error;
    }

    return {
      ataPubkey,
      ix: createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ataPubkey,
        owner,
        tokenMint,
        tokenProgram,
      ),
    };
  }
}

export function unwrapSOLInstruction(
  owner: PublicKey,
  receiver: PublicKey = owner,
  allowOwnerOffCurve = true,
): TransactionInstruction {
  const wsolAta = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    allowOwnerOffCurve,
  );

  return createCloseAccountInstruction(
    wsolAta,
    receiver,
    owner,
    [],
    TOKEN_PROGRAM_ID,
  );
}

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

export function findAssociatedTokenAddress(
  walletAddress: PublicKey,
  tokenMintAddress: PublicKey,
  tokenProgramId: PublicKey,
  allowOwnerOffCurve = true,
): PublicKey {
  return getAssociatedTokenAddressSync(
    tokenMintAddress,
    walletAddress,
    allowOwnerOffCurve,
    tokenProgramId,
  );
}

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

export async function getTokenDecimals(
  connection: Connection,
  mintAddress: PublicKey | string,
  commitment?: Commitment,
): Promise<number> {
  const mintPubkey =
    mintAddress instanceof PublicKey ? mintAddress : new PublicKey(mintAddress);

  const accountInfo = await connection.getAccountInfo(mintPubkey, commitment);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${mintPubkey.toBase58()}`);
  }
  if (
    !accountInfo.owner.equals(TOKEN_PROGRAM_ID) &&
    !accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error(
      `Mint ${mintPubkey.toBase58()} is not owned by a supported token program`,
    );
  }

  return unpackMint(mintPubkey, accountInfo, accountInfo.owner).decimals;
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

export async function prepareTokenAccountTx(
  connection: Connection,
  owner: PublicKey,
  payer: PublicKey,
  tokenMint: PublicKey,
  amount: bigint,
  tokenProgram: PublicKey,
): Promise<{
  tokenAccount: PublicKey;
  transaction: Transaction;
}> {
  const instructions: TransactionInstruction[] = [];
  const { ataPubkey: tokenAccount, ix: createAtaIx } =
    await getOrCreateATAInstruction(
      connection,
      tokenMint,
      owner,
      payer,
      tokenProgram,
    );

  if (createAtaIx) {
    instructions.push(createAtaIx);
  }

  if (tokenMint.equals(NATIVE_MINT) && amount > 0n) {
    instructions.push(...wrapSOLInstruction(owner, tokenAccount, amount));
  }

  const transaction = new Transaction();
  if (instructions.length > 0) {
    transaction.add(...instructions);
  }

  return { tokenAccount, transaction };
}

/**
 * Build a cleanup transaction for wrapped SOL accounts.
 * Returns `null` when the mint is not native SOL.
 */
export function cleanUpTokenAccountTx(
  owner: PublicKey,
  receiver: PublicKey,
  tokenMint: PublicKey,
): { transaction: Transaction } | null {
  if (!tokenMint.equals(NATIVE_MINT)) {
    return null;
  }

  return {
    transaction: new Transaction().add(unwrapSOLInstruction(owner, receiver)),
  };
}
