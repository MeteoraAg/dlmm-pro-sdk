import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  calculateTradingFeeNumerator,
  DlmmProClient,
  DlmmProIDL,
  encodePoolExtensions,
  liquidityBitmap,
  MAX_FEE_NUMERATOR,
  PoolError,
  PoolErrorCode,
  PoolExtension,
  relativeTickFromSlippage,
  tickArraysForRanges,
  validateDynamicFeeParameters,
  type DynamicFeeParameters,
} from "../src";
import {
  createFundedMarket,
  createSvmConnection,
  createToken,
  defaultStaticConfigArgs,
  initializeStaticPool,
  initializeSVM,
  mintSplTokenTo,
  seedPoolLiquidity,
  sendTransaction,
  sendTransactionExpectingError,
  warpToTime,
} from "./helpers";

const QUOTE_TEST_DYNAMIC_FEE: DynamicFeeParameters = {
  maxVolatilityAccumulator: 350_000,
  variableFeeControl: 2_000_000,
  filterPeriod: 30,
  decayPeriod: 600,
  reductionFactor: 5_000,
  minDeltaTickForSignificantSwap: 4,
};

describe("PoolError", () => {
  const idlErrors = DlmmProIDL.errors;
  const codeNames = Object.keys(PoolErrorCode).filter((key) =>
    Number.isNaN(Number(key)),
  );

  it("mirrors the IDL error table one to one", () => {
    expect(idlErrors.length).toBeGreaterThan(0);
    for (const entry of idlErrors) {
      expect(PoolErrorCode[entry.name as keyof typeof PoolErrorCode]).toBe(
        entry.code,
      );
    }
    expect(codeNames.sort()).toEqual(
      idlErrors.map((entry) => entry.name).sort(),
    );
  });

  it("builds every static error with the IDL message", () => {
    const constructors = Object.getOwnPropertyNames(PoolError).filter(
      (name) =>
        typeof (PoolError as unknown as Record<string, unknown>)[name] ===
          "function" && name !== "prototype",
    );
    expect(constructors.length).toBeGreaterThan(0);
    for (const name of constructors) {
      const error = (PoolError as unknown as Record<string, () => PoolError>)[
        name
      ]();
      const entry = idlErrors.find(
        (candidate) => candidate.code === error.code,
      );
      expect(entry, name).toBeDefined();
      expect(error.message, name).toBe(entry!.msg);
      expect(error.name).toBe("PoolError");
    }
  });
});

describe("reward builders", () => {
  it("reject a mint that is not the slot's", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    warpToTime(svm, 1_755_000_000n);
    const market = await createFundedMarket({ svm, client });
    const rewardMint = createToken(svm, market.payer);
    const otherMint = createToken(svm, market.payer);
    const funderToken = mintSplTokenTo(
      svm,
      market.payer,
      rewardMint,
      market.creator.publicKey,
    );
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs: {
        ...defaultStaticConfigArgs(),
        extensions: encodePoolExtensions([PoolExtension.LiquidityMining]),
      },
    });
    const { tx: initTx } = await client.reward.initializeReward({
      pool,
      rewardMint,
      rewardAuthority: market.creator.publicKey,
      creator: market.creator.publicKey,
      payer: market.payer.publicKey,
    });
    sendTransaction(svm, initTx, [market.payer, market.creator]);

    const openTime = new BN(svm.getClock().unixTimestamp.toString()).addn(10);
    const endTime = openTime.addn(86_400 + 60);
    const emissionPerSecond = new BN(1).shln(64);
    const emission = {
      pool,
      rewardMint,
      funderTokenAccount: funderToken,
      funder: market.creator.publicKey,
      authority: market.creator.publicKey,
      parameters: {
        index: 0,
        openTime,
        endTime,
        emissionPerSecond,
        maxAmount: endTime.sub(openTime).mul(emissionPerSecond).shrn(64),
      },
    };
    await expect(
      client.reward.setRewardEmission({ ...emission, rewardMint: otherMint }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidRewardMint });
    await expect(
      client.reward.claimReward({
        pool,
        nftMint: PublicKey.unique(),
        owner: market.lpOwner.publicKey,
        signer: market.lpOwner.publicKey,
        rewardMint: otherMint,
        userTokenAccount: PublicKey.unique(),
        rewardIndex: 0,
        bitmap: liquidityBitmap([0]),
        tickRanges: [{ tickLowerId: -20, tickUpperId: 20 }],
        tickSpacing: 1,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidRewardMint });
    await expect(
      client.reward.withdrawIneligibleRewards({
        pool,
        rewardMint: otherMint,
        receiverTokenAccount: funderToken,
        authority: market.creator.publicKey,
        index: 0,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidRewardMint });

    const { tx } = await client.reward.setRewardEmission(emission);
    for (const key of tx.instructions[0].keys) {
      if (key.pubkey.equals(rewardMint)) {
        key.pubkey = otherMint;
      }
    }
    sendTransactionExpectingError(
      svm,
      tx,
      [market.creator],
      "InvalidRewardMint",
    );
  });
});

describe("limit order tick alignment", () => {
  it("rejects ticks off the pool spacing and accepts an aligned relative band", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });
    const tickSpacing = 10;
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs: { ...defaultStaticConfigArgs(), tickSpacing },
    });
    await seedPoolLiquidity(svm, client, {
      pool,
      lpOwner: market.lpOwner,
      payer: market.payer,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      lpTokenX: market.lpTokenX,
      lpTokenY: market.lpTokenY,
      tickRanges: [{ tickLowerId: -200, tickUpperId: 200 }],
      tickSpacing,
    });
    const amount = new BN(100_000);
    const tickArrays = tickArraysForRanges(
      pool,
      [{ tickLowerId: 10, tickUpperId: 10 }],
      tickSpacing,
    );
    const openArgs = {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenXMint,
      userToken: market.lpTokenX,
      tickArrays,
    };

    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        nftMint: Keypair.generate().publicKey,
        parameters: {
          isAskSide: true,
          maxAmount: amount,
          relativeTick: {
            spacingAlignedMinTickId: -15,
            spacingAlignedMaxTickId: 20,
          },
          ticks: [{ id: 1, amount }],
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        nftMint: Keypair.generate().publicKey,
        parameters: {
          isAskSide: true,
          maxAmount: amount,
          relativeTick: null,
          ticks: [{ id: 5, amount }],
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });

    const { tickCurrentId } = await client.state.fetchPool(pool);
    const relativeTick = relativeTickFromSlippage({
      currentTickId: tickCurrentId,
      tickSpacing,
      slippageTicks: 20,
    });
    expect(relativeTick).toEqual({
      spacingAlignedMinTickId: -20,
      spacingAlignedMaxTickId: 20,
    });
    const nftMintKp = Keypair.generate();
    const opened = await client.limitOrder.openLimitOrder({
      ...openArgs,
      nftMint: nftMintKp.publicKey,
      parameters: {
        isAskSide: true,
        maxAmount: amount,
        relativeTick,
        ticks: [{ id: 1, amount }],
      },
    });
    sendTransaction(svm, opened.tx, [market.payer, market.lpOwner, nftMintKp]);
    const legs = await client.state.decodeLimitOrderData(opened.limitOrder);
    expect(legs.map((leg) => leg.tickId)).toEqual([10]);
  });

  it("requires the slippage to be a multiple of the spacing", () => {
    expect(() =>
      relativeTickFromSlippage({
        currentTickId: 0,
        tickSpacing: 10,
        slippageTicks: 15,
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });
});

describe("dynamic fee parameters", () => {
  it("accept the parameters the quote test trades with", () => {
    expect(() =>
      validateDynamicFeeParameters(QUOTE_TEST_DYNAMIC_FEE),
    ).not.toThrow();
  });

  it("reject a zero significant-swap threshold", () => {
    expect(() =>
      validateDynamicFeeParameters({
        ...QUOTE_TEST_DYNAMIC_FEE,
        minDeltaTickForSignificantSwap: 0,
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });

  it("reject a variable fee that can exceed the fee cap", () => {
    const uncapped = {
      ...QUOTE_TEST_DYNAMIC_FEE,
      maxVolatilityAccumulator: 0xff_ffff,
      variableFeeControl: 0xff_ffff,
    };
    expect(
      calculateTradingFeeNumerator(
        uncapped.variableFeeControl,
        uncapped.maxVolatilityAccumulator,
      ).gt(MAX_FEE_NUMERATOR),
    ).toBe(true);
    expect(() => validateDynamicFeeParameters(uncapped)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });
});
