import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Commitment, Connection } from "@solana/web3.js";
import DlmmProIDL from "../idl/dlmm_pro.json";
import { DlmmPro } from "../idl/dlmm_pro";

export function createDlmmProProgram(
  connection: Connection,
  commitment: Commitment = "confirmed",
) {
  const provider = new AnchorProvider(connection, null as unknown as Wallet, {
    commitment,
  });
  const program = new Program<DlmmPro>(DlmmProIDL, provider);

  return { program };
}
