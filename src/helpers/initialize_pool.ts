import type { Commitment, Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  MAX_SQRT_PRICE,
  MAX_TICK_SPACING,
  MIN_SQRT_PRICE,
  NUMBER_OF_ACTIVATION_MODES,
  POOL_EXTENSION_VARIANT_COUNT,
  WHITELISTED_QUOTE_MINTS,
} from "../constants";
import { PoolError } from "../errors";
import { encodeFixedBaseFeeData } from "../base_fee";
import {
  getCurrentPointNumber,
  validateActivationCombination,
  validateActivationInitialize,
} from "../activation";
import {
  tryCastActivationMode,
  tryCastActivationType,
  tryCastCollectFeeMode,
  tryCastU64,
} from "../math/safe_math";
import {
  ActivationMode,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  PoolExtension,
  type InitializePoolWithDynamicParameters,
} from "../types";
import { isSupportExtension } from "./codec";
import { validatePoolFeeParameters } from "./pool_fees";

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

export async function validateInitializePoolWithDynamicParameters(
  connection: Connection,
  parameters: InitializePoolWithDynamicParameters,
  commitment?: Commitment,
): Promise<void> {
  validatePoolFeeParameters(parameters.poolFees);

  if (
    !Number.isInteger(parameters.tickSpacing) ||
    parameters.tickSpacing <= 0 ||
    parameters.tickSpacing > MAX_TICK_SPACING
  ) {
    throw PoolError.invalidParameters();
  }

  tryCastCollectFeeMode(parameters.collectFeeMode);

  if (
    parameters.initialSqrtPrice.lt(MIN_SQRT_PRICE) ||
    parameters.initialSqrtPrice.gt(MAX_SQRT_PRICE)
  ) {
    throw PoolError.invalidParameters();
  }

  const extensionMax = (1 << POOL_EXTENSION_VARIANT_COUNT) - 1;
  if (
    !Number.isInteger(parameters.extensions) ||
    parameters.extensions < 0 ||
    parameters.extensions > extensionMax
  ) {
    throw PoolError.invalidParameters();
  }

  let activationType: ActivationType;
  try {
    activationType = tryCastActivationType(parameters.activationType);
  } catch {
    throw PoolError.invalidActivationType();
  }
  if (parameters.activationPoint) {
    tryCastU64(parameters.activationPoint);
  }

  if (
    isSupportExtension(parameters.extensions, PoolExtension.ActivationAccess)
  ) {
    const currentPoint = await getCurrentPointNumber(
      connection,
      parameters.activationType,
      commitment,
    );
    const activationPoint = parameters.activationPoint ?? currentPoint;
    const poolActivation = parameters.poolActivation;
    if (!poolActivation) {
      throw PoolError.invalidParameters();
    }

    const activations = poolActivation.activations;
    if (activations.length !== NUMBER_OF_ACTIVATION_MODES) {
      throw PoolError.invalidParameters();
    }

    const activationModes: ActivationMode[] = [];
    for (const activation of activations) {
      validateActivationInitialize(
        activation,
        activationPoint,
        currentPoint,
        activationType,
        parameters.initialSqrtPrice,
        parameters.tickSpacing,
        poolActivation.whitelistedAddLiquidity,
      );
      activationModes.push(tryCastActivationMode(activation.activationMode));
    }

    validateActivationCombination(
      activationModes,
      activationPoint,
      currentPoint,
    );
  } else if (parameters.activationPoint || parameters.poolActivation) {
    throw PoolError.invalidParameters();
  }
}

/**
 * `CollectFeeMode::OnlyY` requires a TokenBadge on token Y unless Y is a
 * whitelisted quote mint (native SOL or USDC).
 */
export function requiresQuoteTokenBadge(
  collectFeeMode: number,
  tokenYMint: PublicKey,
): boolean {
  return (
    collectFeeMode === CollectFeeMode.OnlyY &&
    !WHITELISTED_QUOTE_MINTS.some((mint) => mint.equals(tokenYMint))
  );
}

export function assertQuoteTokenBadge(
  collectFeeMode: number,
  tokenYMint: PublicKey,
  tokenBadgeY: PublicKey | null | undefined,
): void {
  if (requiresQuoteTokenBadge(collectFeeMode, tokenYMint) && !tokenBadgeY) {
    throw PoolError.invalidTokenBadge();
  }
}
