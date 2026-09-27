import { Program } from "@coral-xyz/anchor";
import { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";
import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { StateService } from "./state";
import { createDlmmProProgram, derivePoolAuthority } from "../helpers";

export class DlmmProProgram {
  program: Program<DlmmPro>;
  protected connection: Connection;
  protected poolAuthority: PublicKey;
  protected commitment: Commitment;
  protected state: StateService;

  constructor(connection: Connection, commitment: Commitment) {
    const { program } = createDlmmProProgram(connection, commitment);
    this.program = program;
    this.connection = connection;
    this.poolAuthority = derivePoolAuthority();
    this.commitment = commitment;
    this.state = new StateService(connection, commitment);
  }

  getProgram(): Program<DlmmPro> {
    return this.program;
  }
}
