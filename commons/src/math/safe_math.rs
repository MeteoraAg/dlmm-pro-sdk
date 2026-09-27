use anchor_lang::solana_program::msg;
use ruint::aliases::{U192, U256, U320, U512};
use ruint::Uint;
use ruint::UintTryFrom;
use std::panic::Location;

use crate::{BaseFeeMode, CollectFeeMode, PoolError};

pub trait SafeMath<T>: Sized {
    fn safe_add(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_mul(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_div(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_rem(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_sub(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_shl(self, offset: T) -> Result<Self, PoolError>;
}

macro_rules! checked_impl {
    ($t:ty, $offset:ty) => {
        impl SafeMath<$offset> for $t {
            #[track_caller]
            fn safe_add(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_add(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(PoolError::MathOverflow)
                    }
                }
            }

            #[track_caller]
            fn safe_sub(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_sub(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(PoolError::MathOverflow)
                    }
                }
            }

            #[track_caller]
            fn safe_mul(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_mul(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(PoolError::MathOverflow)
                    }
                }
            }

            #[track_caller]
            fn safe_div(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_div(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(PoolError::MathOverflow)
                    }
                }
            }

            #[track_caller]
            fn safe_rem(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_rem(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(PoolError::MathOverflow)
                    }
                }
            }

            #[track_caller]
            fn safe_shl(self, v: $offset) -> Result<$t, PoolError> {
                match self.checked_shl(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(PoolError::MathOverflow)
                    }
                }
            }
        }
    };
}

checked_impl!(u16, u32);
checked_impl!(i32, u32);
checked_impl!(u32, u32);
checked_impl!(u64, u32);
checked_impl!(i64, u32);
checked_impl!(u128, u32);
checked_impl!(i128, u32);
checked_impl!(usize, u32);
checked_impl!(U192, usize);
checked_impl!(U256, usize);
checked_impl!(U320, usize);
checked_impl!(U512, usize);

pub trait SafeCast<T>: Sized {
    fn safe_cast(self) -> Result<T, PoolError>;
}

macro_rules! try_into_impl {
    ($t:ty, $v:ty) => {
        impl SafeCast<$v> for $t {
            #[track_caller]
            fn safe_cast(self) -> Result<$v, PoolError> {
                match self.try_into() {
                    Ok(result) => Ok(result),
                    Err(_) => {
                        let caller = Location::caller();
                        msg!("TypeCast is failed at {}:{}", caller.file(), caller.line());
                        Err(PoolError::TypeCastFailed)
                    }
                }
            }
        }
    };
}

// ruint does not implement `TryFrom<Uint>` for `Uint`
macro_rules! uint_try_into_impl {
    ($t:ty, $v:ty) => {
        impl SafeCast<$v> for $t {
            #[track_caller]
            fn safe_cast(self) -> Result<$v, PoolError> {
                match <$v as UintTryFrom<$t>>::uint_try_from(self) {
                    Ok(result) => Ok(result),
                    Err(_) => {
                        let caller = Location::caller();
                        msg!("TypeCast is failed at {}:{}", caller.file(), caller.line());
                        Err(PoolError::TypeCastFailed)
                    }
                }
            }
        }
    };
}

try_into_impl!(u8, CollectFeeMode);
try_into_impl!(u8, BaseFeeMode);
try_into_impl!(i128, u128);
try_into_impl!(u128, u64);
try_into_impl!(U192, u64);
try_into_impl!(U192, u128);
try_into_impl!(U256, u64);
try_into_impl!(U320, u64);
try_into_impl!(u64, usize);
try_into_impl!(u64, u16);
try_into_impl!(i64, u64);

uint_try_into_impl!(U320, U192);
uint_try_into_impl!(U256, U192);

pub fn try_cast<S, D>(s: S) -> Result<D, PoolError>
where
    S: TryInto<D>,
{
    s.try_into().map_err(|_| PoolError::TypeCastFailed)
}

/// `value.div_ceil(1 << shift)` without the multi limbs division.
#[inline]
pub fn down_scale_ceil<const BITS: usize, const LIMBS: usize>(
    value: Uint<BITS, LIMBS>,
    shift: usize,
) -> Uint<BITS, LIMBS> {
    let quotient = value >> shift;
    // Any set bit below shift means a non zero remainder.
    if value.trailing_zeros() < shift {
        quotient + Uint::<BITS, LIMBS>::ONE
    } else {
        quotient
    }
}
