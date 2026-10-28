export enum PoolErrorCode {
  MathOverflow = 6000,
  TypeCastFailed = 6001,
  InvalidAdmin = 6002,
  InvalidPermission = 6003,
  UnsupportNativeMintToken2022 = 6004,
  InvalidTokenBadge = 6005,
  UnsupportedMint = 6006,
  InvalidTokenOwnerProof = 6007,
  UnmatchedTickIndex = 6008,
  ReallocExceedMaxLengthPerInstruction = 6009,
  TickIdIsOutOfBound = 6010,
  InsufficientRemainingAccounts = 6011,
  InvalidRemainingAccountSlice = 6012,
  DuplicatedRemainingAccountTypes = 6013,
  InvalidRewardIndex = 6014,
  InvalidTickArray = 6015,
  CannotFindTickFromId = 6016,
  MissingRemainingAccountForTransferHook = 6017,
  NoTransferHookProgram = 6018,
  ExceededSlippage = 6019,
  NotConsumingFullAmountIn = 6020,
  TickArrayBitmapExtensionAccountIsNotProvided = 6021,
  LiquidityIsTooHigh = 6022,
  LiquidityIsZero = 6023,
  UndeterminedError = 6024,
  CannotFindLimitOrderByTickId = 6025,
  CancelNonEmptyLimitOrder = 6026,
  InvalidPoolType = 6027,
  MissingOperatorAccount = 6028,
  RewardUninitialized = 6029,
  InvalidRewardMint = 6030,
  InvalidRewardVault = 6031,
  IdenticalFunder = 6032,
  PositionIsNotEmpty = 6033,
  LimitOrderIsNotEmpty = 6034,
  InvalidActivationType = 6035,
  InvalidBaseFeeMode = 6036,
  InvalidParameters = 6037,
  InvalidAccount = 6038,
  AmountIsZero = 6039,
  InvalidActivationAccess = 6040,
  InvalidRewardState = 6041,
  PositionAlreadyHadVesting = 6042,
  InsufficientLiquidity = 6043,
  BitmapExtensionAccountIsNotProvided = 6044,
  CannotModifyAccount = 6045,
  InvalidPoolCreatorAuthority = 6046,
  InvalidAuthority = 6047,
  DelegatedAmountNonZero = 6048,
  IncorrectATA = 6049,
  InvalidLayoutVersion = 6050,
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

  static invalidActivationType(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidActivationType,
      "Invalid activation type",
    );
  }

  static invalidBaseFeeMode(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidBaseFeeMode,
      "Invalid base fee mode",
    );
  }

  static invalidParameters(detail?: string): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidParameters,
      detail ? `Invalid parameters: ${detail}` : "Invalid parameters",
    );
  }

  static invalidAccount(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidAccount,
      "Invalid account in instruction",
    );
  }

  static invalidPermission(): PoolError {
    return new PoolError(PoolErrorCode.InvalidPermission, "Invalid permission");
  }

  static invalidRemainingAccountSlice(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidRemainingAccountSlice,
      "Invalid remaining account slice",
    );
  }

  static invalidTickArray(): PoolError {
    return new PoolError(PoolErrorCode.InvalidTickArray, "Invalid tick array");
  }

  static cannotFindTickFromId(): PoolError {
    return new PoolError(
      PoolErrorCode.CannotFindTickFromId,
      "Cannot find tick from id",
    );
  }

  static invalidRewardIndex(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidRewardIndex,
      "Invalid reward index",
    );
  }

  static amountIsZero(): PoolError {
    return new PoolError(PoolErrorCode.AmountIsZero, "Amount is zero");
  }

  static liquidityIsZero(): PoolError {
    return new PoolError(PoolErrorCode.LiquidityIsZero, "Liquidity is zero");
  }

  static liquidityIsTooHigh(): PoolError {
    return new PoolError(
      PoolErrorCode.LiquidityIsTooHigh,
      "Liquidity is too high",
    );
  }

  static invalidActivationAccess(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidActivationAccess,
      "Invalid activation access",
    );
  }

  static bitmapExtensionAccountIsNotProvided(): PoolError {
    return new PoolError(
      PoolErrorCode.BitmapExtensionAccountIsNotProvided,
      "Bitmap extension account is not provided",
    );
  }
}
