export enum PoolErrorCode {
  MathOverflow = 6000,
  TypeCastFailed = 6001,
  UndeterminedError = 6024,
  InvalidBaseFeeMode = 6035,
  InvalidParameters = 6036,
  InvalidActivationAccess = 6039,
}

export class PoolError extends Error {
  readonly code: PoolErrorCode;

  constructor(code: PoolErrorCode, message: string) {
    super(message);
    this.name = "PoolError";
    this.code = code;
  }

  static mathOverflow(): PoolError {
    return new PoolError(PoolErrorCode.MathOverflow, "Math operation overflow");
  }

  static typeCastFailed(): PoolError {
    return new PoolError(PoolErrorCode.TypeCastFailed, "Type cast error");
  }

  static undeterminedError(): PoolError {
    return new PoolError(PoolErrorCode.UndeterminedError, "Undetermined error");
  }

  static invalidParameters(): PoolError {
    return new PoolError(PoolErrorCode.InvalidParameters, "Invalid parameters");
  }

  static invalidBaseFeeMode(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidBaseFeeMode,
      "Invalid base fee mode",
    );
  }

  static invalidActivationAccess(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidActivationAccess,
      "Invalid activation access",
    );
  }
}
