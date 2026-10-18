pub use anchor_lang;

anchor_lang::prelude::declare_program!(dlmm_pro);

pub mod activation;
pub mod base_fee;
pub mod constants;
pub mod error;
pub mod extensions;
pub mod liquidity;
// Copied from the program's src/math; only the msg! logging is removed.
#[allow(
    clippy::cast_abs_to_unsigned,
    clippy::doc_lazy_continuation,
    clippy::let_and_return,
    clippy::manual_range_contains,
    clippy::unnecessary_lazy_evaluations
)]
pub mod math;
pub mod parse;
pub mod pda;
pub mod position_fees;
pub mod quote;
pub mod remaining_accounts;
pub mod rewards;
pub mod state;
pub mod tick_array;
pub mod token_2022;

pub use activation::*;
pub use base_fee::*;
pub use constants::*;
pub use error::*;
pub use liquidity::*;
pub use math::*;
pub use parse::*;
pub use pda::*;
pub use position_fees::*;
pub use quote::*;
pub use remaining_accounts::*;
pub use rewards::*;
pub use state::*;
pub use tick_array::*;
pub use token_2022::*;
