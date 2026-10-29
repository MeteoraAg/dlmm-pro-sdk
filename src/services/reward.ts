import { Transaction, type AccountMeta, type PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CREATOR_REWARD_INDEX } from "../constants";
import {
  derivePoolAuthority,
  derivePosition,
  deriveRewardVault,
  findNftAccount,
  positionIndexesFromBitmap,
  resolveInstructionHooks,
} from "../helpers";
import { assertU64, assertU128 } from "../helpers/validation";
import type { SetRewardEmissionParameters, TickRange } from "../types";
import { DlmmProProgram } from "./program";

export class RewardService extends DlmmProProgram {
  /** Reward slot `CREATOR_REWARD_INDEX`, signed by the pool creator. */
  async initializeReward(params: {
    pool: PublicKey;
    rewardMint: PublicKey;
    rewardAuthority: PublicKey;
    creator: PublicKey;
    payer: PublicKey;
    tokenBadge?: PublicKey | null;
    tokenProgram?: PublicKey;
  }): Promise<{ tx: Transaction; rewardVault: PublicKey }> {
    const rewardVault = deriveRewardVault(
      params.pool,
      CREATOR_REWARD_INDEX,
      this.programId,
    );
    const tokenProgram = await this.tokenProgramFor(
      params.rewardMint,
      params.tokenProgram,
    );

    const tx = await this.program.methods
      .initializeReward(CREATOR_REWARD_INDEX)
      .accountsPartial({
        pool: params.pool,
        rewardVault,
        rewardMint: params.rewardMint,
        tokenBadge: params.tokenBadge ?? null,
        operator: null,
        signer: params.creator,
        payer: params.payer,
        rewardAuthority: params.rewardAuthority,
        tokenProgram,
      })
      .transaction();

    tx.feePayer = params.payer;
    return { tx, rewardVault };
  }

  /** Reward slot `CREATOR_REWARD_INDEX`, signed by the pool creator. */
  async updateRewardAuthority(params: {
    pool: PublicKey;
    creator: PublicKey;
    newAuthority: PublicKey;
  }): Promise<{ tx: Transaction }> {
    const tx = await this.program.methods
      .updateRewardAuthority(CREATOR_REWARD_INDEX)
      .accountsPartial({
        pool: params.pool,
        signer: params.creator,
        newAuthority: params.newAuthority,
        operator: null,
      })
      .transaction();

    tx.feePayer = params.creator;
    return { tx };
  }

  async setRewardEmission(params: {
    pool: PublicKey;
    rewardMint: PublicKey;
    /** Defaults to the funder's associated token account. */
    funderTokenAccount?: PublicKey;
    funder: PublicKey;
    authority: PublicKey;
    parameters: SetRewardEmissionParameters;
    tokenProgram?: PublicKey;
    transferHookReward?: AccountMeta[];
  }): Promise<{ tx: Transaction; rewardVault: PublicKey }> {
    if (params.parameters.openTime !== null) {
      assertU64(params.parameters.openTime, "openTime");
    }
    assertU64(params.parameters.endTime, "endTime");
    assertU128(params.parameters.emissionPerSecond, "emissionPerSecond");
    assertU64(params.parameters.maxAmount, "maxAmount");
    const rewardVault = deriveRewardVault(
      params.pool,
      params.parameters.index,
      this.programId,
    );
    const tokenProgram = await this.tokenProgramFor(
      params.rewardMint,
      params.tokenProgram,
    );
    const {
      accounts: [funderTokenAccount],
      preInstructions,
      postInstructions,
    } = await this.prepareTokenAccounts({
      payer: params.funder,
      owner: params.funder,
      tokens: [
        {
          mint: params.rewardMint,
          tokenProgram,
          account: params.funderTokenAccount,
          wrapAmount: params.parameters.maxAmount,
        },
      ],
    });
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      {
        transferHookReward: {
          metas: params.transferHookReward,
          leg: {
            mint: params.rewardMint,
            source: funderTokenAccount,
            destination: rewardVault,
            authority: params.funder,
          },
        },
      },
    );

    const tx = await this.program.methods
      .setRewardEmission(params.parameters, hooks.remainingAccountsInfo)
      .accountsPartial({
        pool: params.pool,
        rewardVault,
        rewardMint: params.rewardMint,
        funderTokenAccount,
        funder: params.funder,
        authority: params.authority,
        tokenProgram,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .transaction();

    tx.feePayer = params.funder;
    return { tx, rewardVault };
  }

  async claimReward(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: PublicKey;
    /**
     * Owner or an approved delegate. A delegate withdraws only to the owner's
     * associated token account.
     */
    signer: PublicKey;
    rewardMint: PublicKey;
    /** Defaults to the owner's associated token account, created when missing. */
    userTokenAccount?: PublicKey;
    rewardIndex: number;
    /** Minimum reward amount to receive after transfer fees; defaults to no minimum. */
    minAmount?: BN;
    /**
     * Position slots to refresh before claiming. `tickRanges` must cover every
     * selected slot that holds liquidity. Build the bitmap with `liquidityBitmap`.
     */
    bitmap: BN;
    tickRanges: TickRange[];
    tokenProgram?: PublicKey;
    nftAccount?: PublicKey;
    transferHookReward?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    positionIndexesFromBitmap(params.bitmap);
    const minAmount = params.minAmount ?? new BN(0);
    assertU64(minAmount, "minAmount");
    const rewardVault = deriveRewardVault(
      params.pool,
      params.rewardIndex,
      this.programId,
    );
    const [{ tickSpacing }, tokenProgram] = await Promise.all([
      this.state.fetchPool(params.pool),
      this.tokenProgramFor(params.rewardMint, params.tokenProgram),
    ]);
    const {
      accounts: [userTokenAccount],
      preInstructions,
      postInstructions,
    } = await this.prepareTokenAccounts({
      payer: params.signer,
      owner: params.owner,
      ownerSigns: params.signer.equals(params.owner),
      tokens: [
        {
          mint: params.rewardMint,
          tokenProgram,
          account: params.userTokenAccount,
        },
      ],
    });
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      {
        transferHookReward: {
          metas: params.transferHookReward,
          leg: {
            mint: params.rewardMint,
            source: rewardVault,
            destination: userTokenAccount,
            authority: derivePoolAuthority(this.programId),
          },
        },
      },
    );
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);

    const refresh = await this.refreshFeesAndRewardsIx({
      pool: params.pool,
      nftMint: params.nftMint,
      nftAccount,
      signer: params.signer,
      bitmap: params.bitmap,
      tickRanges: params.tickRanges,
      tickSpacing,
    });
    const claim = await this.program.methods
      .claimReward(params.rewardIndex, minAmount, hooks.remainingAccountsInfo)
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount,
        signer: params.signer,
        rewardVault,
        rewardMint: params.rewardMint,
        userTokenAccount,
        tokenProgram,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .instruction();

    const tx = new Transaction().add(
      ...preInstructions,
      refresh,
      claim,
      ...postInstructions,
    );
    tx.feePayer = params.signer;
    return { tx };
  }

  async withdrawIneligibleRewards(params: {
    pool: PublicKey;
    rewardMint: PublicKey;
    /**
     * Chosen by the reward authority; need not be the wallet that funded the
     * reward. Defaults to the authority's associated token account, created
     * when missing.
     */
    receiverTokenAccount?: PublicKey;
    authority: PublicKey;
    rewardIndex: number;
    minAmount?: BN;
    tokenProgram?: PublicKey;
    transferHookReward?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    const minAmount = params.minAmount ?? new BN(0);
    assertU64(minAmount, "minAmount");
    const rewardVault = deriveRewardVault(
      params.pool,
      params.rewardIndex,
      this.programId,
    );
    const tokenProgram = await this.tokenProgramFor(
      params.rewardMint,
      params.tokenProgram,
    );
    const {
      accounts: [receiverTokenAccount],
      preInstructions,
      postInstructions,
    } = await this.prepareTokenAccounts({
      payer: params.authority,
      owner: params.authority,
      tokens: [
        {
          mint: params.rewardMint,
          tokenProgram,
          account: params.receiverTokenAccount,
        },
      ],
    });
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      {
        transferHookReward: {
          metas: params.transferHookReward,
          leg: {
            mint: params.rewardMint,
            source: rewardVault,
            destination: receiverTokenAccount,
            authority: derivePoolAuthority(this.programId),
          },
        },
      },
    );

    const tx = await this.program.methods
      .withdrawIneligibleRewards(
        params.rewardIndex,
        minAmount,
        hooks.remainingAccountsInfo,
      )
      .accountsPartial({
        pool: params.pool,
        rewardVault,
        rewardMint: params.rewardMint,
        receiverTokenAccount,
        authority: params.authority,
        tokenProgram,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .transaction();

    tx.feePayer = params.authority;
    return { tx };
  }
}
