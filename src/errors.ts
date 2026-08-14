export enum PoolErrorCode {
  MathOverflow = 6000,
  TypeCastFailed = 6001,
  InvalidParameters = 6036,
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

  static invalidParameters(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidParameters,
      "Invalid parameters",
    );
  }
}
