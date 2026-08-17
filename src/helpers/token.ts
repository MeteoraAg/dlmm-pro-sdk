import {
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
  getMint,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import { TokenProgramFlags } from "../types";

/**
 * Return an ATA address and an idempotent create instruction when the account is missing.
 */
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

/**
 * Build an instruction that closes the owner's wrapped SOL ATA into a receiver.
 */
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

/**
 * Build transfer and sync instructions that wrap SOL into an existing wrapped SOL account.
 */
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

/**
 * Derive the associated token address for a wallet, mint, and token program.
 */
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

/**
 * Fetch a mint account and return its token decimals.
 */
export async function getTokenDecimals(
  connection: Connection,
  mintAddress: PublicKey | string,
): Promise<number> {
  const mintPubkey =
    mintAddress instanceof PublicKey ? mintAddress : new PublicKey(mintAddress);

  const accountInfo = await connection.getAccountInfo(mintPubkey);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${mintPubkey.toBase58()}`);
  }

  const mintInfo = await getMint(
    connection,
    mintPubkey,
    "confirmed",
    accountInfo.owner,
  );
  return mintInfo.decimals;
}

/**
 * Return the SPL Token program ID for a token program flag.
 */
export function getTokenProgram(
  tokenProgramFlag: TokenProgramFlags,
): PublicKey {
  return tokenProgramFlag === TokenProgramFlags.TokenProgram
    ? TOKEN_PROGRAM_ID
    : TOKEN_2022_PROGRAM_ID;
}

/**
 * Return the token program flag from the mint account owner, or `null` if unknown.
 */
export async function getTokenType(
  connection: Connection,
  tokenMint: PublicKey,
): Promise<TokenProgramFlags | null> {
  const accountInfo = await connection.getAccountInfo(tokenMint);
  if (!accountInfo) {
    return null;
  }

  if (accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return TokenProgramFlags.TokenProgram;
  }
  if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TokenProgramFlags.TokenProgram2022;
  }

  return null;
}

/**
 * Build a setup transaction for a token account, including SOL wrapping when needed.
 */
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
