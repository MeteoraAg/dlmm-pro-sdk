//! Mirror of the on-chain program's error enum so error codes and messages
//! match what the program returns.
use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq)]
pub enum PoolError {
    #[msg("Math operation overflow")]
    MathOverflow,

    #[msg("Type cast error")]
    TypeCastFailed,

    #[msg("Invalid admin")]
    InvalidAdmin,

    #[msg("Invalid permission")]
    InvalidPermission,

    #[msg("Unsupported native mint token2022")]
    UnsupportNativeMintToken2022,

    #[msg("Invalid token badge")]
    InvalidTokenBadge,

    #[msg("Unsupported mint")]
    UnsupportedMint,

    #[msg("Invalid token owner proof")]
    InvalidTokenOwnerProof,

    #[msg("Tick index is unmatched")]
    UnmatchedTickIndex,

    #[msg("Realloc exceed max length per instruction")]
    ReallocExceedMaxLengthPerInstruction,

    #[msg("Tick id is out of bound")]
    TickIdIsOutOfBound,

    #[msg("Insufficient remaining accounts")]
    InsufficientRemainingAccounts,

    #[msg("Invalid remaining account slice")]
    InvalidRemainingAccountSlice,

    #[msg("Duplicated remaining account types")]
    DuplicatedRemainingAccountTypes,

    #[msg("Invalid reward index")]
    InvalidRewardIndex,

    #[msg("Invalid tick array")]
    InvalidTickArray,

    #[msg("Cannot find tick from id")]
    CannotFindTickFromId,

    #[msg("Missing remaining account for transfer hook")]
    MissingRemainingAccountForTransferHook,

    #[msg("Remaining account was passed for transfer hook but there's no hook program")]
    NoTransferHookProgram,

    #[msg("Exceeded slippage tolerance")]
    ExceededSlippage,

    #[msg("Not consuming full amount in")]
    NotConsumingFullAmountIn,

    #[msg("TickArray bitmap extension account is not provided")]
    TickArrayBitmapExtensionAccountIsNotProvided,

    #[msg("Liquidity is too high")]
    LiquidityIsTooHigh,

    #[msg("Liquidity is zero")]
    LiquidityIsZero,

    #[msg("Undetermined error")]
    UndeterminedError,

    #[msg("Cannot find limit order by tick id")]
    CannotFindLimitOrderByTickId,

    #[msg("Cancel on empty limit order")]
    CancelNonEmptyLimitOrder,

    #[msg("Invalid pool type")]
    InvalidPoolType,

    #[msg("Missing operator account")]
    MissingOperatorAccount,

    #[msg("Reward not initialized")]
    RewardUninitialized,

    #[msg("Invalid reward vault")]
    InvalidRewardVault,

    #[msg("Identical funder")]
    IdenticalFunder,

    #[msg("Position is not empty")]
    PositionIsNotEmpty,

    #[msg("Limit order is not empty")]
    LimitOrderIsNotEmpty,

    #[msg("Invalid activation type")]
    InvalidActivationType,

    #[msg("Invalid base fee mode")]
    InvalidBaseFeeMode,

    #[msg("Invalid parameters")]
    InvalidParameters,

    #[msg("Invalid account in instruction")]
    InvalidAccount,

    #[msg("Amount is zero")]
    AmountIsZero,

    #[msg("Invalid activation access")]
    InvalidActivationAccess,

    #[msg("Invalid reward state")]
    InvalidRewardState,

    #[msg("Position already had vesting")]
    PositionAlreadyHadVesting,

    #[msg("Liquidity is insufficient")]
    InsufficientLiquidity,

    #[msg("Bitmap extension account is not provided")]
    BitmapExtensionAccountIsNotProvided,

    #[msg("Cannot modify account")]
    CannotModifyAccount,

    #[msg("Invalid pool creator authority")]
    InvalidPoolCreatorAuthority,

    #[msg("Invalid authority")]
    InvalidAuthority,

    #[msg("Delegated amount is not zero")]
    DelegatedAmountNonZero,

    #[msg("Incorrect ATA")]
    IncorrectATA,

    #[msg("Position layout version mismatch")]
    InvalidLayoutVersion,
}
