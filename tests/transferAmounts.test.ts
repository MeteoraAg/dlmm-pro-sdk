import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import {
  bpsWithdrawLiquidity,
  calculateRewardAmount,
  cancelLimitOrderTransfers,
  cappedTransferFeeIncludedAmount,
  getExtraAccountMetasForTransferHook,
  getSqrtPriceFromTickId,
  ineligibleRewardAmount,
  liquidityTransferAmounts,
  maxUnlockedVestingLiquidity,
  PoolErrorCode,
  unlockedLiquidityForWithdraw,
  type DecodedPosition,
  type DecodedPoolRewardInfo,
  type DecodedTick,
  type PositionVesting,
} from "../src";
import { Rounding } from "../src/types";
import {
  createAndFundWallet,
  createSvmConnection,
  createToken,
  initializeSVM,
} from "./helpers";

const U64_MAX = new BN("18446744073709551615");

function reward(
  overrides: Partial<DecodedPoolRewardInfo> = {},
): DecodedPoolRewardInfo {
  return {
    mint: PublicKey.unique(),
    vault: PublicKey.unique(),
    authority: PublicKey.unique(),
    emissionPerSecond: new BN(1).shln(64),
    openTime: new BN(0),
    endTime: new BN(100),
    lastUpdateTime: new BN(0),
    cumulativeSecondsWithEmptyLiquidityReward: new BN(0),
    rewardGrowthGlobal: new BN(0),
    rewardTokenFlag: 0,
    ...overrides,
  };
}

function tick(overrides: Partial<DecodedTick> = {}): DecodedTick {
  return {
    sqrtPrice: getSqrtPriceFromTickId(0),
    liquidityNet: new BN(0),
    liquidityGross: new BN(1),
    feeGrowthOutsideX: new BN(0),
    feeGrowthOutsideY: new BN(0),
    refCount: new BN(0),
    tickId: 0,
    limitOrderAskSide: 1,
    openOrderAmount: new BN(0),
    totalProcessingOrderAmount: new BN(0),
    processedOrderRemainingAmount: new BN(0),
    orderAge: new BN(1),
    fulfilledOrderAmountX: new BN(0),
    fulfilledOrderAmountY: new BN(0),
    limitOrderFeeAskSide: new BN(0),
    limitOrderFeeBidSide: new BN(0),
    ...overrides,
  };
}

describe("transfer amounts", () => {
  it("keeps a fee-less included amount equal to the pool-side amount", () => {
    expect(
      cappedTransferFeeIncludedAmount(null, 0n, new BN(25), new BN(25)).eqn(25),
    ).toBe(true);
    expect(() =>
      cappedTransferFeeIncludedAmount(null, 0n, new BN(25), new BN(24)),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.ExceededSlippage }),
    );
  });

  it("withdraws bps of unlocked liquidity, floored", () => {
    expect(bpsWithdrawLiquidity(new BN(10_000), 2_500).eqn(2_500)).toBe(true);
    expect(bpsWithdrawLiquidity(new BN(3), 5_000).eqn(1)).toBe(true);
  });

  it("does not unlock vesting liquidity before the cliff", () => {
    const vesting: PositionVesting = {
      cliffPoint: new BN(100),
      periodFrequency: new BN(10),
      cliffUnlockBps: 1_000,
      bpsPerPeriod: 1_000,
      numberOfPeriod: 9,
      initialize: 1,
      padding: 0,
    };
    expect(
      maxUnlockedVestingLiquidity(vesting, new BN(1_000), new BN(99)).isZero(),
    ).toBe(true);
    const position: DecodedPosition = {
      unlockedLiquidity: new BN(40),
      permanentLockedLiquidity: new BN(0),
      vestingLiquidity: new BN(1_000),
      releasedVestingLiquidity: new BN(0),
      feeGrowthCheckpointX: new BN(0),
      feeGrowthCheckpointY: new BN(0),
      feePendingX: new BN(0),
      feePendingY: new BN(0),
      tickLowerId: -10,
      tickUpperId: 10,
    };
    expect(
      unlockedLiquidityForWithdraw(position, vesting, new BN(99)).eqn(40),
    ).toBe(true);
    expect(
      maxUnlockedVestingLiquidity(vesting, new BN(1_000), new BN(100)).eqn(100),
    ).toBe(true);
  });

  it("rounds reward funding up and ineligible seconds down", () => {
    const emission = new BN(1).shln(63);
    expect(
      calculateRewardAmount(new BN(1), emission, Rounding.Down).isZero(),
    ).toBe(true);
    expect(calculateRewardAmount(new BN(1), emission, Rounding.Up).eqn(1)).toBe(
      true,
    );
    const funded = reward();
    expect(ineligibleRewardAmount(funded, new BN(0), new BN(10)).eqn(10)).toBe(
      true,
    );
    expect(ineligibleRewardAmount(funded, new BN(5), new BN(10)).isZero()).toBe(
      true,
    );
  });

  it("pays an unfilled ask back in token X and charges no referral fee", () => {
    const result = cancelLimitOrderTransfers({
      collectFeeMode: 0,
      referralEligible: true,
      orders: [
        {
          tick: tick(),
          order: { amount: new BN(50), age: new BN(1), tickId: 0, isAsk: 1 },
        },
      ],
    });
    expect(result.amountX.eqn(50)).toBe(true);
    expect(result.amountY.isZero()).toBe(true);
    expect(result.referralFee.isZero()).toBe(true);
  });

  it("rounds a withdrawal down relative to the matching deposit", () => {
    const ranges = [
      {
        tickLowerId: 0,
        tickUpperId: 10,
        liquidity: new BN("1000000000000000000"),
      },
    ];
    const shared = {
      tickCurrentId: -1,
      currentSqrtPrice: getSqrtPriceFromTickId(0),
      ranges,
      maxAmountX: U64_MAX,
      maxAmountY: U64_MAX,
    };
    const deposit = liquidityTransferAmounts({ ...shared, withdraw: false });
    const withdraw = liquidityTransferAmounts({ ...shared, withdraw: true });
    expect(deposit.amountY.isZero()).toBe(true);
    expect(withdraw.amountX.lte(deposit.amountX)).toBe(true);
    expect(deposit.amountX.gt(withdraw.amountX)).toBe(true);
  });

  it("does not resolve a transfer amount when the mint has no hook", async () => {
    const svm = initializeSVM();
    const connection = createSvmConnection(svm);
    const payer = createAndFundWallet(svm);
    const mint = createToken(svm, payer);
    let calls = 0;
    const metas = await getExtraAccountMetasForTransferHook(connection, {
      mint,
      source: payer.publicKey,
      destination: payer.publicKey,
      authority: payer.publicKey,
      amount: async () => {
        calls += 1;
        return new BN(1);
      },
    });
    expect(metas).toEqual([]);
    expect(calls).toBe(0);
  });
});
