import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  encodeFixedBaseFeeData,
  type DynamicFeeParameters,
  type InitializePoolWithDynamicParameters,
  type StaticConfigParameters,
} from "../../src";

let configIndex = 0;

/** Config PDAs are seeded by an index, so each config takes the next one. */
export function nextConfigIndex(): BN {
  configIndex += 1;
  return new BN(configIndex);
}

export function defaultStaticConfigArgs(
  poolCreatorAuthority: PublicKey | null = PublicKey.default,
): StaticConfigParameters {
  return {
    poolFees: {
      baseFeeParameter: {
        baseFeeMode: BaseFeeMode.Fixed,
        data: encodeFixedBaseFeeData(1_000_000),
      },
      dynamicFeeParameter: null,
    },
    tickSpacing: 1,
    collectFeeMode: CollectFeeMode.OutputToken,
    activationType: ActivationType.Timestamp,
    extensions: 0,
    poolCreatorAuthority,
  };
}

export function defaultDynamicPoolParameters(
  initialSqrtPrice: BN,
): InitializePoolWithDynamicParameters {
  return {
    poolFees: {
      baseFeeParameter: {
        baseFeeMode: BaseFeeMode.Fixed,
        data: encodeFixedBaseFeeData(1_000_000),
      },
      dynamicFeeParameter: null,
    },
    tickSpacing: 1,
    collectFeeMode: CollectFeeMode.OutputToken,
    initialSqrtPrice,
    activationType: ActivationType.Timestamp,
    activationPoint: null,
    extensions: 0,
    poolActivation: null,
  };
}

export const DYNAMIC_FEE_PARAMETERS: DynamicFeeParameters = {
  maxVolatilityAccumulator: 350_000,
  variableFeeControl: 2_000_000,
  filterPeriod: 30,
  decayPeriod: 600,
  reductionFactor: 5_000,
  minDeltaTickForSignificantSwap: 4,
};
