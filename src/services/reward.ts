import { unpackMint } from "@solana/spl-token";
import { PublicKey, Transaction, type AccountMeta } from "@solana/web3.js";
import BN from "bn.js";
import { CREATOR_REWARD_INDEX, WHITELISTED_QUOTE_MINTS } from "../constants";
import { PoolError } from "../errors";
import {
  calculateRewardAmount,
  cappedTransferFeeIncludedAmount,
  claimableRewardAmount,
  derivePoolAuthority,
  derivePosition,
  deriveRewardVault,
  deriveTickArray,
  findNftAccount,
  ineligibleRewardAmount,
  nextRewardUpdates,
  positionIndexesFromBitmap,
  positionTotalLiquidity,
  readClock,
  readTransferFeeMint,
  REWARD_HOOKS,
  resolveInstructionHooks,
  resolveTokenProgram,
  tickArrayRemainingAccounts,
  tickIndexFromId,
  ticksById,
} from "../helpers";
import { assertU64, assertU128 } from "../helpers/validation";
import { safeSub, U64_MAX } from "../math";
import type {
  DecodedPoolRewardInfo,
  SetRewardEmissionParameters,
  TickRange,
} from "../types";
import { Rounding } from "../types";
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
    const { rewards, creator } = await this.rewardPool(params.pool);
    if (!rewards[CREATOR_REWARD_INDEX].mint.equals(PublicKey.default)) {
      throw PoolError.invalidRewardState();
    }
    // `operator` is null, so a non-creator fails on-chain with InvalidPermission.
    this.assertCreator(creator, params.creator, PoolError.invalidPermission());
    await this.assertCreatorRewardMint(params.rewardMint, params.tokenBadge);

    const rewardVault = deriveRewardVault(
      params.pool,
      CREATOR_REWARD_INDEX,
      this.programId,
    );
    const tokenProgram =
      params.tokenProgram ??
      (await resolveTokenProgram(
        this.connection,
        params.rewardMint,
        this.commitment,
      ));

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
    const { rewards, creator } = await this.rewardPool(params.pool);
    const reward = rewards[CREATOR_REWARD_INDEX];
    if (reward.mint.equals(PublicKey.default)) {
      throw PoolError.rewardUninitialized();
    }
    if (reward.authority.equals(params.newAuthority)) {
      throw PoolError.invalidParameters();
    }
    // A missing operator account fails on-chain with MissingOperatorAccount.
    this.assertCreator(
      creator,
      params.creator,
      PoolError.missingOperatorAccount(),
    );

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
    funderTokenAccount: PublicKey;
    funder: PublicKey;
    authority: PublicKey;
    parameters: SetRewardEmissionParameters;
    tokenProgram?: PublicKey;
    transferHookReward?: AccountMeta[];
  }): Promise<{ tx: Transaction; rewardVault: PublicKey }> {
    if (params.parameters.openTime !== null) {
      assertU64(params.parameters.openTime);
    }
    assertU64(params.parameters.endTime);
    assertU128(params.parameters.emissionPerSecond);
    assertU64(params.parameters.maxAmount);
    if (params.parameters.emissionPerSecond.isZero()) {
      throw PoolError.invalidParameters();
    }
    const rewardVault = deriveRewardVault(
      params.pool,
      params.parameters.index,
      this.programId,
    );
    const tokenProgram =
      params.tokenProgram ??
      (await resolveTokenProgram(
        this.connection,
        params.rewardMint,
        this.commitment,
      ));
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      REWARD_HOOKS,
      { transferHookReward: params.transferHookReward },
      {
        transferHookReward: {
          mint: params.rewardMint,
          source: params.funderTokenAccount,
          destination: rewardVault,
          authority: params.funder,
          amount: async () => {
            const clock = await readClock(this.connection, this.commitment);
            const openTime = params.parameters.openTime ?? clock.timestamp;
            const poolSide = calculateRewardAmount(
              safeSub(params.parameters.endTime, openTime, U64_MAX),
              params.parameters.emissionPerSecond,
              Rounding.Up,
            );
            const mint = await readTransferFeeMint(
              this.connection,
              params.rewardMint,
              this.commitment,
            );
            return cappedTransferFeeIncludedAmount(
              mint,
              clock.epoch,
              poolSide,
              params.parameters.maxAmount,
            );
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
        funderTokenAccount: params.funderTokenAccount,
        funder: params.funder,
        authority: params.authority,
        tokenProgram,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .transaction();

    tx.feePayer = params.funder;
    return { tx, rewardVault };
  }

  async claimReward(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: PublicKey;
    signer: PublicKey;
    rewardMint: PublicKey;
    userTokenAccount: PublicKey;
    rewardIndex: number;
    /** Minimum reward amount to receive after transfer fees; defaults to no minimum. */
    minAmount?: BN;
    /**
     * Position slots to refresh before claiming. `tickRanges` must cover every
     * selected slot. Build the bitmap with `liquidityBitmap`.
     */
    bitmap: BN;
    tickRanges: TickRange[];
    tickSpacing: number;
    tokenProgram?: PublicKey;
    nftAccount?: PublicKey;
    transferHookReward?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    positionIndexesFromBitmap(params.bitmap);
    assertU64(params.minAmount ?? new BN(0));
    const { tickSpacing } = await this.state.fetchPool(params.pool);
    if (params.tickSpacing !== tickSpacing) {
      throw PoolError.invalidParameters();
    }
    const rewardVault = deriveRewardVault(
      params.pool,
      params.rewardIndex,
      this.programId,
    );
    const tokenProgram =
      params.tokenProgram ??
      (await resolveTokenProgram(
        this.connection,
        params.rewardMint,
        this.commitment,
      ));
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      REWARD_HOOKS,
      { transferHookReward: params.transferHookReward },
      {
        transferHookReward: {
          mint: params.rewardMint,
          source: rewardVault,
          destination: params.userTokenAccount,
          authority: derivePoolAuthority(this.programId),
          amount: () => this.refreshedRewardAmount(params),
        },
      },
    );

    const refresh = await this.program.methods
      .refreshFeesAndRewards(params.bitmap)
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount,
        signer: params.signer,
      })
      .remainingAccounts(
        tickArrayRemainingAccounts(
          params.pool,
          params.tickRanges,
          tickSpacing,
          false,
          this.programId,
        ),
      )
      .transaction();
    const claim = await this.program.methods
      .claimReward(
        params.rewardIndex,
        params.minAmount ?? new BN(0),
        hooks.remainingAccountsInfo,
      )
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount,
        signer: params.signer,
        rewardVault,
        rewardMint: params.rewardMint,
        userTokenAccount: params.userTokenAccount,
        tokenProgram,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .transaction();

    const tx = new Transaction().add(
      ...refresh.instructions,
      ...claim.instructions,
    );
    tx.feePayer = params.signer;
    return { tx };
  }

  async withdrawIneligibleRewards(params: {
    pool: PublicKey;
    rewardMint: PublicKey;
    /** Chosen by the reward authority; need not be the wallet that funded the reward. */
    receiverTokenAccount: PublicKey;
    authority: PublicKey;
    index: number;
    minAmount?: BN;
    tokenProgram?: PublicKey;
    transferHookReward?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    assertU64(params.minAmount ?? new BN(0));
    const rewardVault = deriveRewardVault(
      params.pool,
      params.index,
      this.programId,
    );
    const tokenProgram =
      params.tokenProgram ??
      (await resolveTokenProgram(
        this.connection,
        params.rewardMint,
        this.commitment,
      ));
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      REWARD_HOOKS,
      { transferHookReward: params.transferHookReward },
      {
        transferHookReward: {
          mint: params.rewardMint,
          source: rewardVault,
          destination: params.receiverTokenAccount,
          authority: derivePoolAuthority(this.programId),
          amount: () => this.ineligibleRewardHookAmount(params),
        },
      },
    );

    const tx = await this.program.methods
      .withdrawIneligibleRewards(
        params.index,
        params.minAmount ?? new BN(0),
        hooks.remainingAccountsInfo,
      )
      .accountsPartial({
        pool: params.pool,
        rewardVault,
        rewardMint: params.rewardMint,
        receiverTokenAccount: params.receiverTokenAccount,
        authority: params.authority,
        tokenProgram,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .transaction();

    tx.feePayer = params.authority;
    return { tx };
  }

  private async refreshedRewardAmount(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    rewardIndex: number;
    bitmap: BN;
  }): Promise<BN> {
    const { pool, extensions } = await this.state.fetchPoolWithExtensions(
      params.pool,
    );
    if (!extensions.rewards) {
      throw PoolError.invalidPoolType();
    }
    if (
      params.rewardIndex < 0 ||
      params.rewardIndex >= extensions.rewards.length
    ) {
      throw PoolError.invalidRewardIndex();
    }
    const reward = extensions.rewards[params.rewardIndex];
    if (reward.mint.equals(PublicKey.default)) {
      throw PoolError.rewardUninitialized();
    }
    const clock = await readClock(this.connection, this.commitment);
    const next = nextRewardUpdates({
      rewards: extensions.rewards,
      liquidity: pool.liquidity,
      currentTimestamp: clock.timestamp,
    })[params.rewardIndex];
    const { positions } = await this.state.fetchPositionArrayWithPositions(
      derivePosition(params.nftMint, this.programId),
      { withReward: true },
    );
    const selected = positionIndexesFromBitmap(params.bitmap);
    for (const index of selected) {
      if (!positions[index]) {
        throw PoolError.invalidParameters();
      }
    }
    const refreshed = new Set(
      selected.filter(
        (index) => !positionTotalLiquidity(positions[index]).isZero(),
      ),
    );
    const tickIndexes = new Set<number>();
    for (const index of refreshed) {
      tickIndexes.add(
        tickIndexFromId(positions[index].tickLowerId, pool.tickSpacing),
      );
      tickIndexes.add(
        tickIndexFromId(positions[index].tickUpperId, pool.tickSpacing),
      );
    }
    const ticks = ticksById(
      await this.state.fetchTickArraysWithTicks(
        [...tickIndexes].map((index) =>
          deriveTickArray(params.pool, index, this.programId),
        ),
        { withReward: true },
      ),
    );
    return claimableRewardAmount({
      positions,
      refreshed,
      tickCurrentId: pool.tickCurrentId,
      ticks,
      rewardIndex: params.rewardIndex,
      rewardGrowthGlobal: next.rewardGrowthGlobal,
    });
  }

  private async ineligibleRewardHookAmount(params: {
    pool: PublicKey;
    index: number;
  }): Promise<BN> {
    const { pool, extensions } = await this.state.fetchPoolWithExtensions(
      params.pool,
    );
    const reward = extensions.rewards?.[params.index];
    if (!reward || reward.mint.equals(PublicKey.default)) {
      throw PoolError.rewardUninitialized();
    }
    const clock = await readClock(this.connection, this.commitment);
    return ineligibleRewardAmount(reward, pool.liquidity, clock.timestamp);
  }

  private async rewardPool(
    pool: PublicKey,
  ): Promise<{ rewards: DecodedPoolRewardInfo[]; creator: PublicKey }> {
    const { pool: state, extensions } =
      await this.state.fetchPoolWithExtensions(pool);
    if (!extensions.rewards) {
      throw PoolError.invalidPoolType();
    }
    return { rewards: extensions.rewards, creator: state.creator };
  }

  /**
   * Creator initialization does not allow a freeze authority unless the mint
   * is whitelisted or a token badge is supplied. An operator signer may allow
   * freeze; these builders always pass `operator: null`.
   */
  private async assertCreatorRewardMint(
    rewardMint: PublicKey,
    tokenBadge: PublicKey | null | undefined,
  ): Promise<void> {
    if (tokenBadge && !tokenBadge.equals(PublicKey.default)) {
      return;
    }
    if (WHITELISTED_QUOTE_MINTS.some((mint) => mint.equals(rewardMint))) {
      return;
    }
    const info = await this.connection.getAccountInfo(
      rewardMint,
      this.commitment,
    );
    if (!info) {
      throw PoolError.invalidAccount();
    }
    const mint = unpackMint(rewardMint, info, info.owner);
    if (mint.freezeAuthority !== null) {
      throw PoolError.unsupportedMint();
    }
  }

  private assertCreator(
    creator: PublicKey,
    signer: PublicKey,
    error: PoolError,
  ): void {
    if (!creator.equals(signer)) {
      throw error;
    }
  }
}
