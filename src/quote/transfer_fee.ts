import {
  calculateFee,
  getEpochFee,
  getTransferFeeConfig,
  MAX_FEE_BASIS_POINTS,
  ONE_IN_BASIS_POINTS,
  type Mint,
  type TransferFee,
} from "@solana/spl-token";
import BN from "bn.js";
import { PoolError } from "../errors";
import { toBigInt, tryCastU64 } from "../math";

const U64_MAX_BIGINT = (1n << 64n) - 1n;

export type TransferFeeExcludedAmount = {
  amount: BN;
  transferFee: BN;
};

export type TransferFeeIncludedAmount = {
  amount: BN;
  transferFee: BN;
};

/**
 * Amount that arrives after the mint's Token-2022 transfer fee — the
 * off-chain equivalent of the program's `calculate_transfer_fee_excluded_amount`.
 * Pass the unpacked mint (`unpackMint` with the owning token program) or
 * `null` for mints without transfer-fee data.
 */
export function calculateTransferFeeExcludedAmount(
  mint: Mint | null | undefined,
  epoch: bigint,
  transferFeeIncludedAmount: BN,
): TransferFeeExcludedAmount {
  tryCastU64(transferFeeIncludedAmount);
  if (epoch < 0n || epoch > U64_MAX_BIGINT) {
    throw PoolError.typeCastFailed();
  }
  const transferFeeConfig = mint ? getTransferFeeConfig(mint) : null;
  if (!transferFeeConfig) {
    return {
      amount: transferFeeIncludedAmount.clone(),
      transferFee: new BN(0),
    };
  }

  const epochFee = getEpochFee(transferFeeConfig, epoch);
  const transferFee = new BN(
    calculateFee(epochFee, toBigInt(transferFeeIncludedAmount)).toString(),
  );
  const amount = transferFeeIncludedAmount.sub(transferFee);
  if (amount.isNeg()) {
    throw PoolError.mathOverflow();
  }
  return { amount, transferFee };
}

function calculatePreFeeAmount(
  transferFee: TransferFee,
  postFeeAmount: bigint,
): bigint | null {
  const maximumFee = transferFee.maximumFee;
  const transferFeeBasisPoints = BigInt(transferFee.transferFeeBasisPoints);
  // no fee, same amount
  if (transferFeeBasisPoints === 0n) {
    return postFeeAmount;
  }
  // 0 zero out, 0 in
  if (postFeeAmount === 0n) {
    return 0n;
  }
  // 100%, cap at max fee
  if (transferFeeBasisPoints === ONE_IN_BASIS_POINTS) {
    const preFeeAmount = maximumFee + postFeeAmount;
    return preFeeAmount > U64_MAX_BIGINT ? null : preFeeAmount;
  }
  const numerator = postFeeAmount * ONE_IN_BASIS_POINTS;
  const denominator = ONE_IN_BASIS_POINTS - transferFeeBasisPoints;
  const rawPreFeeAmount = (numerator + denominator - 1n) / denominator;

  if (rawPreFeeAmount - postFeeAmount >= maximumFee) {
    const preFeeAmount = postFeeAmount + maximumFee;
    return preFeeAmount > U64_MAX_BIGINT ? null : preFeeAmount;
  }
  return rawPreFeeAmount > U64_MAX_BIGINT ? null : rawPreFeeAmount;
}

function calculateInverseFee(
  transferFee: TransferFee,
  postFeeAmount: bigint,
): bigint | null {
  const preFeeAmount = calculatePreFeeAmount(transferFee, postFeeAmount);
  if (preFeeAmount === null) {
    return null;
  }
  return calculateFee(transferFee, preFeeAmount);
}

/**
 * Amount to send so that `transferFeeExcludedAmount` arrives after the mint's
 * Token-2022 transfer fee — the off-chain equivalent of the program's
 * `calculate_transfer_fee_included_amount_unchecked`.
 * Pass the unpacked mint (`unpackMint` with the owning token program) or
 * `null` for mints without transfer-fee data.
 */
export function calculateTransferFeeIncludedAmount(
  mint: Mint | null | undefined,
  epoch: bigint,
  transferFeeExcludedAmount: BN,
): TransferFeeIncludedAmount {
  tryCastU64(transferFeeExcludedAmount);
  if (epoch < 0n || epoch > U64_MAX_BIGINT) {
    throw PoolError.typeCastFailed();
  }
  if (transferFeeExcludedAmount.isZero()) {
    return { amount: new BN(0), transferFee: new BN(0) };
  }

  const transferFeeConfig = mint ? getTransferFeeConfig(mint) : null;
  if (!transferFeeConfig) {
    return {
      amount: transferFeeExcludedAmount.clone(),
      transferFee: new BN(0),
    };
  }

  const epochFee = getEpochFee(transferFeeConfig, epoch);
  const excludedAmount = toBigInt(transferFeeExcludedAmount);

  let transferFee: bigint;
  if (epochFee.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS) {
    // SPL returns zero for the inverse fee at 100%; use the configured cap.
    transferFee = epochFee.maximumFee;
  } else {
    const inverseFee = calculateInverseFee(epochFee, excludedAmount);
    if (inverseFee === null) {
      throw PoolError.mathOverflow();
    }
    transferFee = inverseFee;
  }

  const includedAmount = excludedAmount + transferFee;
  if (includedAmount > U64_MAX_BIGINT) {
    throw PoolError.mathOverflow();
  }

  const transferFeeVerification = calculateFee(epochFee, includedAmount);
  if (transferFee !== transferFeeVerification) {
    throw PoolError.mathOverflow();
  }

  return {
    amount: new BN(includedAmount.toString()),
    transferFee: new BN(transferFee.toString()),
  };
}
