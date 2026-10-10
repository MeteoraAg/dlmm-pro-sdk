import {
  createApproveInstruction,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { type Keypair, type PublicKey, Transaction } from "@solana/web3.js";
import type { LiteSVM } from "litesvm";
import { sendTransaction } from "./svm";

/** The program only honours a delegate whose `delegated_amount` is zero. */
export function approveNftDelegate(
  svm: LiteSVM,
  args: { nftAccount: PublicKey; owner: Keypair; delegate: PublicKey },
): void {
  const tx = new Transaction().add(
    createApproveInstruction(
      args.nftAccount,
      args.delegate,
      args.owner.publicKey,
      0n,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  sendTransaction(svm, tx, [args.owner]);
}
