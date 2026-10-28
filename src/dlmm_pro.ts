import type { Program } from "@coral-xyz/anchor";
import type { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { createDlmmProProgram } from "./helpers/create_program";
import type { DlmmPro } from "./idl/dlmm-pro/dlmm_pro";
import {
  LimitOrderService,
  PoolService,
  PositionService,
  RewardService,
  StateService,
} from "./services";

export interface DlmmProProvider {
  readonly connection: Connection;
  readonly commitment: Commitment;
  readonly program: Program<DlmmPro>;
}

export interface DlmmProClientContext extends DlmmProProvider {
  readonly state: StateService;
}

export class DlmmProClient implements DlmmProClientContext {
  readonly connection: Connection;
  readonly commitment: Commitment;
  readonly program: Program<DlmmPro>;
  readonly state: StateService;
  readonly limitOrder: LimitOrderService;
  readonly pool: PoolService;
  readonly position: PositionService;
  readonly reward: RewardService;

  constructor(
    connection: Connection,
    commitment: Commitment = "confirmed",
    programId?: PublicKey,
  ) {
    this.connection = connection;
    this.commitment = commitment;
    this.program = createDlmmProProgram(connection, programId);
    this.state = new StateService(this);
    this.limitOrder = new LimitOrderService(this);
    this.pool = new PoolService(this);
    this.position = new PositionService(this);
    this.reward = new RewardService(this);
  }
}
