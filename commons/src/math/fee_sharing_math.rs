use anchor_lang::prelude::*;

use crate::*;

#[derive(Default, Debug, Clone, Copy)]
pub struct FeeSetting {
    pub fees_on_input: bool,
    pub fees_on_token_x: bool,
    pub has_referral: bool,
    pub has_partner: bool,
    pub mm_protocol_fee_bps: u16,
    pub limit_order_protocol_fee_bps: u16,
    pub partner_fee_bps: u16,
}

pub fn calculate_shared_amounts(
    amount: u64,
    numerator: u64,
    denominator: u64,
    rounding: Rounding,
) -> Result<(u64, u64)> {
    if numerator == 0 {
        return Ok((0, amount));
    }
    if amount == 0 {
        return Ok((0, 0));
    }

    let prod = u128::from(amount).safe_mul(numerator.into())?;

    let first_amount = match rounding {
        Rounding::Up => prod.div_ceil(denominator.into()).safe_cast()?,
        Rounding::Down => prod.safe_div(denominator.into())?.safe_cast()?,
    };

    let second_amount = amount.safe_sub(first_amount)?;
    Ok((first_amount, second_amount))
}

pub fn get_excluded_fee_amount(
    trade_fee_numerator: u64,
    included_fee_amount: u64,
) -> Result<(u64, u64)> {
    let prod = u128::from(included_fee_amount).safe_mul(trade_fee_numerator.into())?;
    let trading_fee = prod.div_ceil(FEE_DENOMINATOR.into()).safe_cast()?;
    let excluded_fee_amount = included_fee_amount.safe_sub(trading_fee)?;
    Ok((excluded_fee_amount, trading_fee))
}

pub fn get_included_fee_amount(
    trade_fee_numerator: u64,
    excluded_fee_amount: u64,
) -> Result<(u64, u64)> {
    let included_fee_amount = u128::from(excluded_fee_amount)
        .safe_mul(FEE_DENOMINATOR.into())?
        .div_ceil(FEE_DENOMINATOR.safe_sub(trade_fee_numerator)?.into())
        .safe_cast()?;
    let fee_amount = included_fee_amount.safe_sub(excluded_fee_amount)?;
    Ok((included_fee_amount, fee_amount))
}

pub struct SplitFees {
    pub mm_fee: u64,
    pub limit_order_fee: u64,
    pub protocol_fee_on_limit_order_fee: u64,
    pub protocol_fee_on_mm_fee: u64,
}

pub fn split_fees(
    trading_fee: u64, // total fee
    fee_setting: &FeeSetting,
    filled_amount_result: &FilledAmountResult,
) -> Result<SplitFees> {
    let (mm_share, total_share) = if fee_setting.fees_on_input {
        (
            filled_amount_result.mm_amount_in,
            filled_amount_result.amount_in,
        )
    } else {
        (
            filled_amount_result.mm_amount_out,
            filled_amount_result.out_amount,
        )
    };

    // A max fee can leave no filled amount to use as a sharing denominator.
    if total_share == 0 {
        return Ok(SplitFees {
            mm_fee: 0,
            limit_order_fee: 0,
            protocol_fee_on_limit_order_fee: 0,
            protocol_fee_on_mm_fee: trading_fee,
        });
    }

    // Match the program's MM-favoring remainder.
    let (total_mm_fee, total_limit_order_fee) =
        calculate_shared_amounts(trading_fee, mm_share, total_share, Rounding::Up)?;

    let (protocol_fee_on_mm_fee, mm_fee) = calculate_shared_amounts(
        total_mm_fee,
        fee_setting.mm_protocol_fee_bps.into(),
        MAX_BASIS_POINT.into(),
        Rounding::Down,
    )?;

    let (protocol_fee_on_limit_order_fee, limit_order_fee) = calculate_shared_amounts(
        total_limit_order_fee,
        fee_setting.limit_order_protocol_fee_bps.into(),
        MAX_BASIS_POINT.into(),
        Rounding::Down,
    )?;

    Ok(SplitFees {
        mm_fee,
        limit_order_fee,
        protocol_fee_on_limit_order_fee,
        protocol_fee_on_mm_fee,
    })
}
