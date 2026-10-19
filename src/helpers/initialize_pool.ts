import type { Commitment, Connection } from "@solana/web3.js";
import {
  MAX_SQRT_PRICE,
  MAX_TICK_SPACING,
  MIN_SQRT_PRICE,
  NUMBER_OF_ACTIVATION_MODES,
  POOL_EXTENSION_VARIANT_COUNT,
} from "../constants";
import { PoolError } from "../errors";
import {
  getActivationHandler,
  getCurrentPointNumber,
  validateActivationCombination,
} from "../activation";
import {
  tryCastActivationMode,
  tryCastActivationType,
  tryCastCollectFeeMode,
  tryCastU64,
} from "../math/safe_math";
import {
  ActivationMode,
  PoolExtension,
  type InitializePoolWithDynamicParameters,
} from "../types";
import { isSupportExtension } from "./codec";
import { validatePoolFeeParameters } from "./pool_fees";

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
    throw PoolError.invalidParameters(
      "tickSpacing must be an integer in 1..=MAX_TICK_SPACING",
    );
  }

  tryCastCollectFeeMode(parameters.collectFeeMode);

  if (
    parameters.initialSqrtPrice.lt(MIN_SQRT_PRICE) ||
    parameters.initialSqrtPrice.gt(MAX_SQRT_PRICE)
  ) {
    throw PoolError.invalidParameters(
      "initialSqrtPrice must be in MIN_SQRT_PRICE..=MAX_SQRT_PRICE",
    );
  }

  const extensionMax = (1 << POOL_EXTENSION_VARIANT_COUNT) - 1;
  if (
    !Number.isInteger(parameters.extensions) ||
    parameters.extensions < 0 ||
    parameters.extensions > extensionMax
  ) {
    throw PoolError.invalidParameters(
      "extensions must be a bitmask of PoolExtension variants",
    );
  }

  const activationType = tryCastActivationType(parameters.activationType);
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
      throw PoolError.invalidParameters(
        "poolActivation is required with the ActivationAccess extension",
      );
    }

    const activations = poolActivation.activations;
    if (activations.length !== NUMBER_OF_ACTIVATION_MODES) {
      throw PoolError.invalidParameters(
        "poolActivation.activations must have one entry per activation mode",
      );
    }

    const activationModes: ActivationMode[] = [];
    for (const activation of activations) {
      getActivationHandler(activation).validateInitialize({
        activationPoint,
        currentPoint,
        activationType,
        initSqrtPrice: parameters.initialSqrtPrice,
        tickSpacing: parameters.tickSpacing,
        whitelistedAddLiquidity: poolActivation.whitelistedAddLiquidity,
      });
      activationModes.push(tryCastActivationMode(activation.activationMode));
    }

    validateActivationCombination(
      activationModes,
      activationPoint,
      currentPoint,
    );
  } else if (parameters.activationPoint || parameters.poolActivation) {
    throw PoolError.invalidParameters(
      "activationPoint and poolActivation require the ActivationAccess extension",
    );
  }
}
