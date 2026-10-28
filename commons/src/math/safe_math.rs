use ruint::aliases::{U192, U256, U320, U512};
use ruint::Uint;
use ruint::UintTryFrom;

use crate::{BaseFeeMode, CollectFeeMode, PoolError};

pub trait SafeMath: Sized {
    fn safe_add(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_mul(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_div(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_rem(self, rhs: Self) -> Result<Self, PoolError>;
    fn safe_sub(self, rhs: Self) -> Result<Self, PoolError>;
}

macro_rules! checked_impl {
    ($t:ty) => {
        impl SafeMath for $t {
            fn safe_add(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_add(v) {
                    Some(result) => Ok(result),
                    None => Err(PoolError::MathOverflow),
                }
            }

            fn safe_sub(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_sub(v) {
                    Some(result) => Ok(result),
                    None => Err(PoolError::MathOverflow),
                }
            }

            fn safe_mul(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_mul(v) {
                    Some(result) => Ok(result),
                    None => Err(PoolError::MathOverflow),
                }
            }

            fn safe_div(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_div(v) {
                    Some(result) => Ok(result),
                    None => Err(PoolError::MathOverflow),
                }
            }

            fn safe_rem(self, v: $t) -> Result<$t, PoolError> {
                match self.checked_rem(v) {
                    Some(result) => Ok(result),
                    None => Err(PoolError::MathOverflow),
                }
            }
        }
    };
}

checked_impl!(u16);
checked_impl!(i32);
checked_impl!(u32);
checked_impl!(u64);
checked_impl!(i64);
checked_impl!(u128);
checked_impl!(i128);
checked_impl!(usize);
checked_impl!(U192);
checked_impl!(U256);
checked_impl!(U320);
checked_impl!(U512);

pub trait SafeCast<T>: Sized {
    fn safe_cast(self) -> Result<T, PoolError>;
}

macro_rules! try_into_impl {
    ($t:ty, $v:ty) => {
        impl SafeCast<$v> for $t {
            fn safe_cast(self) -> Result<$v, PoolError> {
                match self.try_into() {
                    Ok(result) => Ok(result),
                    Err(_) => Err(PoolError::TypeCastFailed),
                }
            }
        }
    };
}

// ruint does not implement `TryFrom<Uint>` for `Uint`
macro_rules! uint_try_into_impl {
    ($t:ty, $v:ty) => {
        impl SafeCast<$v> for $t {
            fn safe_cast(self) -> Result<$v, PoolError> {
                match <$v as UintTryFrom<$t>>::uint_try_from(self) {
                    Ok(result) => Ok(result),
                    Err(_) => Err(PoolError::TypeCastFailed),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u320_to_u192_cast_success() {
        for value in [
            U320::ZERO,
            U320::ONE,
            U320::from(u64::MAX),
            U320::from(u128::MAX),
            U320::from(U192::MAX) - U320::ONE,
            U320::from(U192::MAX),
        ] {
            let casted: U192 = value.safe_cast().unwrap();
            assert_eq!(U320::from(casted), value, "value = {value}");
        }
    }

    #[test]
    fn u320_to_u192_cast_failure() {
        for value in [
            U320::from(U192::MAX) + U320::ONE,
            U320::from(U192::MAX) + U320::ONE + U320::ONE,
            U320::MAX,
        ] {
            let result: Result<U192, PoolError> = value.safe_cast();
            assert_eq!(result, Err(PoolError::TypeCastFailed), "value = {value}");
        }
    }

    #[test]
    fn down_scale_ceil_matches_div_ceil() {
        let q64 = U320::ONE << 64;
        let q128 = U320::ONE << 128;

        for value in [
            U320::ZERO,
            U320::ONE,
            q64 - U320::ONE,
            q64,
            q64 + U320::ONE,
            q128 - U320::ONE,
            q128,
            q128 + U320::ONE,
            U320::MAX,
        ] {
            assert_eq!(
                down_scale_ceil(value, 64),
                value.div_ceil(q64),
                "shift = 64, value = {value}"
            );
            assert_eq!(
                down_scale_ceil(value, 128),
                value.div_ceil(q128),
                "shift = 128, value = {value}"
            );
        }
    }
}
