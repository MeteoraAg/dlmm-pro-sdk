import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { ACCESS_REGISTRY_PROGRAM_ID, DLMM_PRO_PROGRAM_ID } from "../../src";

const helpersDir = path.dirname(fileURLToPath(import.meta.url));

// tests/fixtures/dlmm_pro.so: dlmm-pro main 9590139, built with `--features local`.
// tests/fixtures/access_registry.so: access-registry d542263, built with `--features local`.
function programSoPath(): string {
  const soPath =
    process.env.DLMM_PRO_SO_PATH ??
    path.resolve(helpersDir, "../fixtures/dlmm_pro.so");

  if (!fs.existsSync(soPath)) {
    throw new Error(`dlmm_pro.so not found at ${soPath}.`);
  }

  return soPath;
}

export function initializeSVM(): LiteSVM {
  const svm = new LiteSVM();
  svm.addProgramFromFile(DLMM_PRO_PROGRAM_ID, programSoPath());
  // AccessRegistry owns TokenBadge, required for OnlyY pool creation
  svm.addProgramFromFile(
    ACCESS_REGISTRY_PROGRAM_ID,
    path.resolve(helpersDir, "../fixtures/access_registry.so"),
  );
  return svm;
}

export function createAndFundWallet(
  svm: LiteSVM,
  keypair = Keypair.generate(),
): Keypair {
  svm.airdrop(keypair.publicKey, BigInt(1000 * LAMPORTS_PER_SOL));
  return keypair;
}

export function sendTransaction(
  svm: LiteSVM,
  tx: Transaction,
  signers: Keypair[],
): void {
  tx.recentBlockhash = svm.latestBlockhash();
  if (!tx.feePayer) {
    tx.feePayer = signers[0].publicKey;
  }
  tx.sign(...signers);

  const result = svm.sendTransaction(tx);
  svm.expireBlockhash();

  if (result instanceof FailedTransactionMetadata) {
    throw new Error(result.meta().prettyLogs());
  }
}

export function sendTransactionExpectingError(
  svm: LiteSVM,
  tx: Transaction,
  signers: Keypair[],
  message: string,
): void {
  try {
    sendTransaction(svm, tx, signers);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes(message)) {
      return;
    }
    throw error;
  }
  throw new Error(`expected transaction to fail with "${message}"`);
}

export function warpToTime(svm: LiteSVM, unixTimestamp: bigint): void {
  const clock = svm.getClock();
  clock.unixTimestamp = unixTimestamp;
  svm.setClock(clock);
}

export function accountExists(svm: LiteSVM, address: PublicKey): boolean {
  const account = svm.getAccount(address);
  return !!account && account.data.length > 0;
}
