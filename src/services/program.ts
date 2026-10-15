import type { Program } from "@coral-xyz/anchor";
import type {
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import type BN from "bn.js";
import type { DlmmProClientContext } from "../dlmm_pro";
import { derivePosition, tickArrayRemainingAccounts } from "../helpers";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";
import type { TickRange } from "../types";
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

  protected refreshFeesAndRewardsTx(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    nftAccount: PublicKey;
    signer: PublicKey;
    bitmap: BN;
    tickRanges: TickRange[];
    tickSpacing: number;
  }): Promise<Transaction> {
    return this.program.methods
      .refreshFeesAndRewards(params.bitmap)
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount: params.nftAccount,
        signer: params.signer,
      })
      .remainingAccounts(
        // Slots without liquidity are skipped before their ticks are read.
        params.tickRanges.length === 0
          ? []
          : tickArrayRemainingAccounts(
              params.pool,
              params.tickRanges,
              params.tickSpacing,
              false,
              this.programId,
            ),
      )
      .transaction();
  }
}
