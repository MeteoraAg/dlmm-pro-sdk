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
  InvalidRewardVault = 6030,
  IdenticalFunder = 6031,
  PositionIsNotEmpty = 6032,
  LimitOrderIsNotEmpty = 6033,
  InvalidActivationType = 6034,
  InvalidBaseFeeMode = 6035,
  InvalidParameters = 6036,
  InvalidAccount = 6037,
  AmountIsZero = 6038,
  InvalidActivationAccess = 6039,
  InvalidRewardState = 6040,
  PositionAlreadyHadVesting = 6041,
  InsufficientLiquidity = 6042,
  BitmapExtensionAccountIsNotProvided = 6043,
  CannotModifyAccount = 6044,
  InvalidPoolCreatorAuthority = 6045,
  InvalidAuthority = 6046,
  DelegatedAmountNonZero = 6047,
  IncorrectATA = 6048,
  InvalidLayoutVersion = 6049,
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

  static invalidParameters(): PoolError {
    return new PoolError(PoolErrorCode.InvalidParameters, "Invalid parameters");
  }

  static invalidAccount(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidAccount,
      "Invalid account in instruction",
    );
  }

  static unsupportedMint(): PoolError {
    return new PoolError(PoolErrorCode.UnsupportedMint, "Unsupported mint");
  }

  static invalidTokenBadge(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidTokenBadge,
      "Invalid token badge",
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

  static cannotFindLimitOrderByTickId(): PoolError {
    return new PoolError(
      PoolErrorCode.CannotFindLimitOrderByTickId,
      "Cannot find limit order by tick id",
    );
  }

  static cancelNonEmptyLimitOrder(): PoolError {
    return new PoolError(
      PoolErrorCode.CancelNonEmptyLimitOrder,
      "Cancel non-empty limit order",
    );
  }

  static notConsumingFullAmountIn(): PoolError {
    return new PoolError(
      PoolErrorCode.NotConsumingFullAmountIn,
      "Not consuming full amount in",
    );
  }

  static tickArrayBitmapExtensionAccountIsNotProvided(): PoolError {
    return new PoolError(
      PoolErrorCode.TickArrayBitmapExtensionAccountIsNotProvided,
      "Tick array bitmap extension account is not provided",
    );
  }

  static invalidRewardIndex(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidRewardIndex,
      "Invalid reward index",
    );
  }

  static invalidRewardState(): PoolError {
    return new PoolError(
      PoolErrorCode.InvalidRewardState,
      "Invalid reward state",
    );
  }

  static rewardUninitialized(): PoolError {
    return new PoolError(
      PoolErrorCode.RewardUninitialized,
      "Reward uninitialized",
    );
  }

  static invalidPoolType(): PoolError {
    return new PoolError(PoolErrorCode.InvalidPoolType, "Invalid pool type");
  }

  static missingOperatorAccount(): PoolError {
    return new PoolError(
      PoolErrorCode.MissingOperatorAccount,
      "Missing operator account",
    );
  }

  static amountIsZero(): PoolError {
    return new PoolError(PoolErrorCode.AmountIsZero, "Amount is zero");
  }

  static exceededSlippage(): PoolError {
    return new PoolError(
      PoolErrorCode.ExceededSlippage,
      "Exceeded slippage tolerance",
    );
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
