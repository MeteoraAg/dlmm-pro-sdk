pub use anchor_lang;

#[allow(unexpected_cfgs)]
mod program {
    // declare_program! needs `anchor_lang` in this module's scope.
    #[allow(clippy::single_component_path_imports)]
    use anchor_lang;
    anchor_lang::prelude::declare_program!(dlmm_pro);
}
pub use program::dlmm_pro;

pub mod activation;
pub mod base_fee;
pub mod constants;
pub mod error;
pub mod extensions;
pub mod liquidity;
pub mod math;
pub mod parse;
pub mod pda;
pub mod position_fees;
pub mod quote;
pub mod remaining_accounts;
pub mod state;
pub mod tick_array;
pub mod token_2022;

pub use activation::*;
pub use base_fee::*;
pub use constants::*;
pub use error::*;
pub use extensions::*;
pub use liquidity::*;
pub use math::*;
pub use parse::*;
pub use pda::*;
pub use position_fees::*;
pub use quote::*;
pub use remaining_accounts::*;
pub use state::*;
pub use tick_array::*;
pub use token_2022::*;
