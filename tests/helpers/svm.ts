import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IdlEvents } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  FailedTransactionMetadata,
  LiteSVM,
  type TransactionMetadata,
} from "litesvm";
import {
  ACCESS_REGISTRY_PROGRAM_ID,
  createDlmmProProgram,
  DLMM_PRO_PROGRAM_ID,
  type DlmmProTypes,
} from "../../src";

const helpersDir = path.dirname(fileURLToPath(import.meta.url));

// tests/fixtures/dlmm_pro.so: dlmm-pro release 0.1.0 (4ac3a79), built with `--features local`.
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
  // access-registry d542263, built with `--features local`. It owns TokenBadge,
  // which `OnlyY` pool creation requires.
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
): TransactionMetadata {
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
  return result;
}

type DlmmProEvent = IdlEvents<DlmmProTypes>;

// The coder never touches the connection; Program supplies the camelCase IDL.
const eventCoder = createDlmmProProgram(new Connection("http://127.0.0.1:8899"))
  .coder.events;

// sha256("anchor:event")[..8], the prefix of every `emit_cpi!` instruction.
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");

/** Decodes an `emit_cpi!` event through the shipped IDL. */
export function findEvent<N extends keyof DlmmProEvent>(
  meta: TransactionMetadata,
  name: N,
): DlmmProEvent[N] {
  for (const batch of meta.innerInstructions()) {
    for (const inner of batch) {
      const data = Buffer.from(inner.instruction().data());
      if (!data.subarray(0, 8).equals(EVENT_IX_TAG)) {
        continue;
      }
      const event = eventCoder.decode(data.subarray(8).toString("base64"));
      if (event?.name === name) {
        return event.data as DlmmProEvent[N];
      }
    }
  }
  throw new Error(`event "${name}" not emitted`);
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
