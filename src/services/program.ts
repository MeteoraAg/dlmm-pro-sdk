import type { Program } from "@coral-xyz/anchor";
import type {
  AccountMeta,
  Commitment,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import type BN from "bn.js";
import type { DlmmProClientContext } from "../dlmm_pro";
import {
  derivePoolAuthority,
  derivePosition,
  deriveReserve,
  readTokenAccountMint,
  resolveTokenProgram,
  tickArrayRemainingAccounts,
  type TransferHookLeg,
} from "../helpers";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";
import type { TickRange } from "../types";
import type { StateService } from "./state";

export class DlmmProProgram {
  protected readonly program: Program<DlmmPro>;
  protected readonly connection: Connection;
  protected readonly commitment: Commitment;
  protected readonly state: StateService;

  protected get programId(): PublicKey {
    return this.program.programId;
  }

  constructor(client: DlmmProClientContext) {
    this.program = client.program;
    this.connection = client.connection;
    this.commitment = client.commitment;
    this.state = client.state;
  }

  protected async tokenProgramFor(
    mint: PublicKey,
    explicit?: PublicKey,
  ): Promise<PublicKey> {
    return (
      explicit ?? resolveTokenProgram(this.connection, mint, this.commitment)
    );
  }

  protected async referralHook(
    pool: PublicKey,
    referral: PublicKey | null | undefined,
    metas: AccountMeta[] | undefined,
  ): Promise<{ metas?: AccountMeta[]; leg?: TransferHookLeg }> {
    if (!referral || metas !== undefined) {
      return { metas };
    }
    const mint = await readTokenAccountMint(
      this.connection,
      referral,
      this.commitment,
    );
    return {
      leg: {
        mint,
        source: deriveReserve(mint, pool, this.programId),
        destination: referral,
        authority: derivePoolAuthority(this.programId),
      },
    };
  }

  protected refreshFeesAndRewardsIx(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    nftAccount: PublicKey;
    signer: PublicKey;
    bitmap: BN;
    tickRanges: TickRange[];
    tickSpacing: number;
  }): Promise<TransactionInstruction> {
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
      .instruction();
  }
}
