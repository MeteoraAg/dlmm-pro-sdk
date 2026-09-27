import type { Program } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import { createDlmmProProgram } from "../../src/helpers/create_program";
import type { DlmmPro } from "../../src/idl/dlmm-pro/dlmm_pro";

export function createIdlProgram(connection: Connection): Program<DlmmPro> {
  return createDlmmProProgram(connection);
}
