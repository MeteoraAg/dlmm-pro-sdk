import type { Program } from "@coral-xyz/anchor";
import type { Commitment, Connection, PublicKey } from "@solana/web3.js";
import type { DlmmProClientContext } from "../dlmm_pro";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";
import type { StateService } from "./state";

export class DlmmProProgram {
  protected readonly program: Program<DlmmPro>;
  protected readonly programId: PublicKey;
  protected readonly connection: Connection;
  protected readonly commitment: Commitment;
  protected readonly state: StateService;

  constructor(client: DlmmProClientContext) {
    this.program = client.program;
    this.programId = client.program.programId;
    this.connection = client.connection;
    this.commitment = client.commitment;
    this.state = client.state;
  }
}
