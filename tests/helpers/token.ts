import { BN } from "@coral-xyz/anchor";
import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createInitializeMintCloseAuthorityInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createMintToInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { LiteSVM } from "litesvm";
import { MINT_AMOUNT, TOKEN_DECIMALS } from "./constants";
import { sendTransaction } from "./svm";

export function createToken(
  svm: LiteSVM,
  payer: Keypair,
  decimals = TOKEN_DECIMALS,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  const mint = Keypair.generate();
  const lamports = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: Number(lamports),
      space: MINT_SIZE,
      programId: tokenProgram,
    }),
    createInitializeMint2Instruction(
      mint.publicKey,
      decimals,
      payer.publicKey,
      null,
      tokenProgram,
    ),
  );
  sendTransaction(svm, tx, [payer, mint]);
  return mint.publicKey;
}

export function createToken2022WithFreeze(
  svm: LiteSVM,
  payer: Keypair,
  decimals = TOKEN_DECIMALS,
): PublicKey {
  const mint = Keypair.generate();
  const lamports = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: Number(lamports),
      space: MINT_SIZE,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mint.publicKey,
      decimals,
      payer.publicKey,
      payer.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  sendTransaction(svm, tx, [payer, mint]);
  return mint.publicKey;
}

export type Token2022MintExtension =
  | {
      type: ExtensionType.TransferFeeConfig;
      transferFeeBasisPoints: number;
      maximumFee: bigint;
    }
  | { type: ExtensionType.MintCloseAuthority }
  | { type: ExtensionType.TransferHook; programId: PublicKey };

function initializeExtension(
  mint: PublicKey,
  authority: PublicKey,
  extension: Token2022MintExtension,
): TransactionInstruction {
  switch (extension.type) {
    case ExtensionType.TransferFeeConfig:
      return createInitializeTransferFeeConfigInstruction(
        mint,
        authority,
        authority,
        extension.transferFeeBasisPoints,
        extension.maximumFee,
        TOKEN_2022_PROGRAM_ID,
      );
    case ExtensionType.MintCloseAuthority:
      return createInitializeMintCloseAuthorityInstruction(
        mint,
        authority,
        TOKEN_2022_PROGRAM_ID,
      );
    case ExtensionType.TransferHook:
      return createInitializeTransferHookInstruction(
        mint,
        authority,
        extension.programId,
        TOKEN_2022_PROGRAM_ID,
      );
  }
}

/** A Token-2022 mint with `payer` as the mint authority and every extension authority. */
export function createToken2022Mint(
  svm: LiteSVM,
  payer: Keypair,
  extensions: Token2022MintExtension[],
): PublicKey {
  const mint = Keypair.generate();
  const space = getMintLen(extensions.map((extension) => extension.type));
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(space))),
      space,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    ...extensions.map((extension) =>
      initializeExtension(mint.publicKey, payer.publicKey, extension),
    ),
    createInitializeMint2Instruction(
      mint.publicKey,
      TOKEN_DECIMALS,
      payer.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  sendTransaction(svm, tx, [payer, mint]);
  return mint.publicKey;
}

export function getOrCreateAssociatedTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  if (svm.getAccount(ata)) {
    return ata;
  }

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      tokenProgram,
    ),
  );
  sendTransaction(svm, tx, [payer]);
  return ata;
}

export function mintSplTokenTo(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  recipient: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  amount: bigint = MINT_AMOUNT,
): PublicKey {
  const ata = getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    mint,
    recipient,
    tokenProgram,
  );
  const tx = new Transaction().add(
    createMintToInstruction(
      mint,
      ata,
      payer.publicKey,
      amount,
      [],
      tokenProgram,
    ),
  );
  sendTransaction(svm, tx, [payer]);
  return ata;
}

export function getTokenAmount(svm: LiteSVM, ata: PublicKey): BN {
  const info = svm.getAccount(ata);
  if (!info || info.data.length === 0) {
    return new BN(0);
  }
  return new BN(AccountLayout.decode(Buffer.from(info.data)).amount.toString());
}
