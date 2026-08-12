import { Commitment, Connection } from "@solana/web3.js";
import {
  LimitOrderService,
  PoolService,
  PositionService,
  RewardService,
  StateService,
} from "./services";

export class DlmmProClient {
  public limitOrder: LimitOrderService;
  public pool: PoolService;
  public position: PositionService;
  public reward: RewardService;
  public state: StateService;
  public commitment: Commitment;
  public connection: Connection;

  constructor(connection: Connection, commitment: Commitment) {
    this.limitOrder = new LimitOrderService(connection, commitment);
    this.pool = new PoolService(connection, commitment);
    this.position = new PositionService(connection, commitment);
    this.reward = new RewardService(connection, commitment);
    this.state = new StateService(connection, commitment);
    this.commitment = commitment;
    this.connection = connection;
  }

  /**
   * Create a client with all DlmmPro services.
   */
  static create(
    connection: Connection,
    commitment: Commitment = "confirmed",
  ): DlmmProClient {
    return new DlmmProClient(connection, commitment);
  }
}
