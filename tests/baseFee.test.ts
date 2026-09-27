import BN from "bn.js";
import { describe, expect, it } from "vitest";
import {
  BaseFeeMode,
  decodePodAlignedFeeMarketCapScheduler,
  decodePodAlignedFeeTimeScheduler,
  decodePodAlignedFixedFee,
  encodeFixedBaseFeeData,
  encodeMarketCapSchedulerBaseFeeData,
  encodeTimeSchedulerBaseFeeData,
  getBaseFeeNumerator,
  getFeeInPeriod,
  PoolError,
  U64_MAX,
  validateBaseFeeConfig,
  type BaseFeeConfig,
} from "../src";

const Q64 = new BN(1).shln(64);

function baseFeeConfig(
  baseFeeMode: BaseFeeMode,
  data: number[],
): BaseFeeConfig {
  return { baseFeeMode, data };
}

describe("pod encoders", () => {
  it("rejects negative inputs", () => {
    expect(() => encodeFixedBaseFeeData(new BN(-1))).toThrow(PoolError);
    expect(() => encodeFixedBaseFeeData(-1)).toThrow(PoolError);
    expect(() =>
      encodeTimeSchedulerBaseFeeData({
        cliffFeeNumerator: 1,
        periodFrequency: new BN(-5),
        reductionFactor: 1,
        numberOfPeriod: 1,
      }),
    ).toThrow(PoolError);
    expect(() =>
      encodeMarketCapSchedulerBaseFeeData({
        cliffFeeNumerator: 1,
        reductionFactor: -1,
        sqrtPriceStepBps: 1,
        schedulerExpirationDuration: 1,
        numberOfPeriod: 1,
      }),
    ).toThrow(PoolError);
  });

  it("rejects values wider than the field", () => {
    expect(() => encodeFixedBaseFeeData(U64_MAX.addn(1))).toThrow(PoolError);
    expect(() =>
      encodeTimeSchedulerBaseFeeData({
        cliffFeeNumerator: 1,
        periodFrequency: 1,
        reductionFactor: 1,
        numberOfPeriod: 0x10000,
      }),
    ).toThrow(PoolError);
    expect(() =>
      encodeMarketCapSchedulerBaseFeeData({
        cliffFeeNumerator: 1,
        reductionFactor: 1,
        sqrtPriceStepBps: 0x100000000,
        schedulerExpirationDuration: 1,
        numberOfPeriod: 1,
      }),
    ).toThrow(PoolError);
  });

  it("accepts field maxima", () => {
    expect(() => encodeFixedBaseFeeData(U64_MAX)).not.toThrow();
    expect(() =>
      encodeTimeSchedulerBaseFeeData({
        cliffFeeNumerator: U64_MAX,
        periodFrequency: U64_MAX,
        reductionFactor: U64_MAX,
        numberOfPeriod: 0xffff,
      }),
    ).not.toThrow();
  });
});

describe("pod decoders", () => {
  it("rejects base fee data that is not 31 bytes", () => {
    expect(() =>
      decodePodAlignedFixedFee(
        baseFeeConfig(BaseFeeMode.Fixed, Array(30).fill(0)),
      ),
    ).toThrow(PoolError);
    expect(() =>
      decodePodAlignedFeeTimeScheduler(
        baseFeeConfig(BaseFeeMode.TimeSchedulerLinear, Array(32).fill(0)),
      ),
    ).toThrow(PoolError);
    expect(() =>
      decodePodAlignedFeeMarketCapScheduler(
        baseFeeConfig(BaseFeeMode.MarketCapSchedulerLinear, []),
      ),
    ).toThrow(PoolError);
  });
});

describe("time scheduler linear parity", () => {
  const config = baseFeeConfig(
    BaseFeeMode.TimeSchedulerLinear,
    encodeTimeSchedulerBaseFeeData({
      cliffFeeNumerator: 400_000_000,
      periodFrequency: 60,
      reductionFactor: 1_366_666,
      numberOfPeriod: 120,
    }),
  );
  const activationPoint = new BN(1000);

  const fee = (currentPoint: number): string =>
    getBaseFeeNumerator(
      config,
      new BN(currentPoint),
      activationPoint,
      Q64,
      Q64,
    ).toString();

  it("validates", () => {
    expect(() => validateBaseFeeConfig(config)).not.toThrow();
  });

  it("matches the program formula", () => {
    expect(fee(1000)).toBe("400000000");
    expect(fee(1059)).toBe("400000000");
    expect(fee(1060)).toBe("398633334");
    expect(fee(1420)).toBe("390433338");
    expect(fee(8200)).toBe("236000080");
  });

  it("clamps to number_of_period outside the schedule", () => {
    expect(fee(999)).toBe("236000080");
    expect(fee(1_000_000)).toBe("236000080");
  });
});

describe("time scheduler exponential parity", () => {
  const config = baseFeeConfig(
    BaseFeeMode.TimeSchedulerExponential,
    encodeTimeSchedulerBaseFeeData({
      cliffFeeNumerator: 500_000_000,
      periodFrequency: 30,
      reductionFactor: 250,
      numberOfPeriod: 120,
    }),
  );
  const activationPoint = new BN(1000);

  const fee = (currentPoint: number): string =>
    getBaseFeeNumerator(
      config,
      new BN(currentPoint),
      activationPoint,
      Q64,
      Q64,
    ).toString();

  it("validates", () => {
    expect(() => validateBaseFeeConfig(config)).not.toThrow();
  });

  it("matches the program pow vectors", () => {
    expect(fee(1000)).toBe("500000000");
    expect(fee(1030)).toBe("487500000");
    expect(fee(1089)).toBe("475312500");
    expect(fee(1300)).toBe("388164810");
  });

  it("clamps to number_of_period outside the schedule", () => {
    expect(fee(999)).toBe("23962045");
    expect(fee(999_999)).toBe("23962045");
  });

  it("matches getFeeInPeriod vectors directly", () => {
    const cliff = new BN(500_000_000);
    const reduction = new BN(250);
    expect(getFeeInPeriod(cliff, reduction, 0).toString()).toBe("500000000");
    expect(getFeeInPeriod(cliff, reduction, 1).toString()).toBe("487500000");
    expect(getFeeInPeriod(cliff, reduction, 10).toString()).toBe("388164810");
    expect(getFeeInPeriod(cliff, reduction, 120).toString()).toBe("23962045");
  });
});

describe("market cap scheduler parity", () => {
  const activationPoint = new BN(1000);
  const initSqrtPrice = Q64;

  const linearConfig = baseFeeConfig(
    BaseFeeMode.MarketCapSchedulerLinear,
    encodeMarketCapSchedulerBaseFeeData({
      cliffFeeNumerator: 300_000_000,
      reductionFactor: 2_000_000,
      sqrtPriceStepBps: 100,
      schedulerExpirationDuration: 3600,
      numberOfPeriod: 100,
    }),
  );
  const exponentialConfig = baseFeeConfig(
    BaseFeeMode.MarketCapSchedulerExponential,
    encodeMarketCapSchedulerBaseFeeData({
      cliffFeeNumerator: 300_000_000,
      reductionFactor: 500,
      sqrtPriceStepBps: 100,
      schedulerExpirationDuration: 3600,
      numberOfPeriod: 100,
    }),
  );

  const sqrtPriceAtBps = (bps: number): BN =>
    initSqrtPrice.muln(10_000 + bps).divn(10_000);

  const fee = (
    config: BaseFeeConfig,
    currentPoint: number,
    sqrtPrice: BN,
  ): string =>
    getBaseFeeNumerator(
      config,
      new BN(currentPoint),
      activationPoint,
      initSqrtPrice,
      sqrtPrice,
    ).toString();

  it("validates", () => {
    expect(() => validateBaseFeeConfig(linearConfig)).not.toThrow();
    expect(() => validateBaseFeeConfig(exponentialConfig)).not.toThrow();
  });

  it("matches the program formula for the linear path", () => {
    expect(fee(linearConfig, 1000, initSqrtPrice)).toBe("300000000");
    expect(fee(linearConfig, 1000, initSqrtPrice.subn(1))).toBe("300000000");
    expect(fee(linearConfig, 1000, sqrtPriceAtBps(250))).toBe("296000000");
    expect(fee(linearConfig, 1000, sqrtPriceAtBps(999))).toBe("282000000");
    expect(fee(linearConfig, 1000, sqrtPriceAtBps(20_000))).toBe("100000000");
  });

  it("matches the program formula for the exponential path", () => {
    expect(fee(exponentialConfig, 1000, initSqrtPrice)).toBe("300000000");
    expect(fee(exponentialConfig, 1000, sqrtPriceAtBps(250))).toBe("270750000");
    expect(fee(exponentialConfig, 1000, sqrtPriceAtBps(20_000))).toBe(
      "1776158",
    );
  });

  it("clamps to number_of_period outside the scheduler window", () => {
    expect(fee(linearConfig, 999, initSqrtPrice)).toBe("100000000");
    expect(fee(linearConfig, 4601, initSqrtPrice)).toBe("100000000");
    expect(fee(exponentialConfig, 4601, initSqrtPrice)).toBe("1776158");
  });
});
