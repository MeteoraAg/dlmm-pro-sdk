//! Tick-array selection helpers for building instructions, mirroring the
//! TypeScript SDK's `tick_array.ts`.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use std::collections::BTreeSet;

use crate::*;

pub fn tick_index_from_id(tick_id: i32, tick_spacing: u16) -> Result<i32> {
    TickArray::get_tick_index_from_tick_id(tick_id, tick_spacing)
}

pub fn is_usable_tick_id(tick_id: i32, tick_spacing: u16) -> bool {
    TickArray::is_usable_tick_id(tick_id, tick_spacing)
}

pub use crate::dlmm_pro::types::TickRange;

/// Position-flow only (open/expand/add/remove/close): range-endpoint arrays
/// ascending — wrong for swap, use [`tick_arrays_for_swap`].
pub fn tick_arrays_for_ranges(
    pool: Pubkey,
    ranges: &[TickRange],
    tick_spacing: u16,
) -> Result<Vec<Pubkey>> {
    let mut indexes = BTreeSet::new();
    for range in ranges {
        indexes.insert(tick_index_from_id(range.tick_lower_id, tick_spacing)?);
        indexes.insert(tick_index_from_id(range.tick_upper_id, tick_spacing)?);
    }
    Ok(indexes
        .into_iter()
        .map(|index| derive_tick_array(pool, index))
        .collect())
}

pub fn tick_array_remaining_accounts(
    pool: Pubkey,
    ranges: &[TickRange],
    tick_spacing: u16,
) -> Result<Vec<AccountMeta>> {
    Ok(tick_arrays_for_ranges(pool, ranges, tick_spacing)?
        .into_iter()
        .map(|pubkey| AccountMeta::new(pubkey, false))
        .collect())
}

/// Tick-array indexes with at least one set bit in the pool's internal bitmap.
pub fn get_bitmap_set_indices_from_pool(pool: &Pool) -> Vec<i32> {
    let mut indices = vec![];
    for (chunk, bits) in pool.tick_array_bitmap.iter().enumerate() {
        for bit in 0..64 {
            if bits & (1u64 << bit) != 0 {
                indices.push((chunk * 64 + bit) as i32 - BITMAP_SIZE);
            }
        }
    }
    indices
}

/// Tick-array indexes with at least one set bit in the bitmap extension.
pub fn get_extension_bitmap_set_indices(extension: &TickArrayBitmapExtension) -> Vec<i32> {
    let mut indices = vec![];

    for (offset, bitmap) in extension.positive_bitmap.iter().enumerate() {
        for (chunk, bits) in bitmap.iter().enumerate() {
            for bit in 0..64 {
                if bits & (1u64 << bit) != 0 {
                    indices.push(
                        (offset as i32) * BITMAP_SIZE + (chunk * 64 + bit) as i32 + BITMAP_SIZE,
                    );
                }
            }
        }
    }

    for (offset, bitmap) in extension.negative_bitmap.iter().enumerate() {
        for (chunk, bits) in bitmap.iter().enumerate() {
            for bit in 0..64 {
                if bits & (1u64 << bit) != 0 {
                    indices.push(
                        -((offset as i32) * BITMAP_SIZE + (chunk * 64 + bit) as i32 + 1)
                            - BITMAP_SIZE,
                    );
                }
            }
        }
    }

    indices.sort_unstable();
    indices
}

#[derive(Debug, Clone)]
pub struct TickArraysForSwap {
    /// Tick array addresses ordered for the program's single forward pass:
    /// descending indices when `swap_for_y`, ascending otherwise.
    pub tick_arrays: Vec<Pubkey>,
    /// The tick-array indexes behind `tick_arrays`, same order.
    pub tick_array_indexes: Vec<i32>,
    /// The program reads the extension account only while the pool flag is
    /// set, and then whenever the internal bitmap runs out mid-traversal, so
    /// the flag alone decides: pass it when set even if every selected array
    /// is internal, never when clear even if the current index overflows.
    pub requires_bitmap_extension: bool,
}

/// Tick arrays for a swap, starting from the current tick's array.
pub fn tick_arrays_for_swap(
    pool_address: Pubkey,
    pool: &Pool,
    extension: Option<&TickArrayBitmapExtension>,
    swap_for_y: bool,
    max_tick_arrays: usize,
) -> Result<TickArraysForSwap> {
    let current_index = tick_index_from_id(pool.tick_current_id, pool.tick_spacing)?;

    let mut indexes: BTreeSet<i32> = get_bitmap_set_indices_from_pool(pool).into_iter().collect();
    if let Some(extension) = extension {
        indexes.extend(get_extension_bitmap_set_indices(extension));
    }

    let selected: Vec<i32> = if swap_for_y {
        indexes
            .into_iter()
            .rev()
            .filter(|&index| index <= current_index)
            .take(max_tick_arrays)
            .collect()
    } else {
        indexes
            .into_iter()
            .filter(|&index| index >= current_index)
            .take(max_tick_arrays)
            .collect()
    };

    Ok(TickArraysForSwap {
        tick_arrays: selected
            .iter()
            .map(|&index| derive_tick_array(pool_address, index))
            .collect(),
        tick_array_indexes: selected,
        requires_bitmap_extension: pool.is_bitmap_extension_initialized(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool_state(tick_current_id: i32, tick_spacing: u16, set_indexes: &[i32]) -> Pool {
        let mut pool = Pool {
            tick_current_id,
            tick_spacing,
            ..Default::default()
        };
        for &index in set_indexes {
            let offset = (index + BITMAP_SIZE) as usize;
            pool.tick_array_bitmap[offset / 64] |= 1u64 << (offset % 64);
        }
        pool
    }

    fn extension_state(indexes: &[i32]) -> TickArrayBitmapExtension {
        let mut extension = TickArrayBitmapExtension::default();
        for &index in indexes {
            let value = if index >= BITMAP_SIZE {
                (index - BITMAP_SIZE) as usize
            } else {
                (-index - 1 - BITMAP_SIZE) as usize
            };
            let offset = value / BITMAP_SIZE as usize;
            let chunk = (value % BITMAP_SIZE as usize) / 64;
            let bit = value % 64;
            if index >= BITMAP_SIZE {
                extension.positive_bitmap[offset][chunk] |= 1u64 << bit;
            } else {
                extension.negative_bitmap[offset][chunk] |= 1u64 << bit;
            }
        }
        extension
    }

    #[test]
    fn orders_arrays_descending_when_swapping_for_y() {
        let pool = Pubkey::new_unique();
        let selection =
            tick_arrays_for_swap(pool, &pool_state(0, 1, &[-3, -1, 0, 2]), None, true, 3).unwrap();

        assert_eq!(
            selection.tick_arrays,
            vec![
                derive_tick_array(pool, 0),
                derive_tick_array(pool, -1),
                derive_tick_array(pool, -3),
            ]
        );
        assert_eq!(selection.tick_array_indexes, vec![0, -1, -3]);
        assert!(!selection.requires_bitmap_extension);
    }

    #[test]
    fn orders_arrays_ascending_when_swapping_for_x() {
        let pool = Pubkey::new_unique();
        let selection =
            tick_arrays_for_swap(pool, &pool_state(0, 1, &[-3, -1, 0, 2]), None, false, 3).unwrap();

        assert_eq!(
            selection.tick_arrays,
            vec![derive_tick_array(pool, 0), derive_tick_array(pool, 2)]
        );
        assert!(!selection.requires_bitmap_extension);
    }

    #[test]
    fn caps_the_number_of_arrays_at_max_tick_arrays() {
        let pool = Pubkey::new_unique();
        let selection =
            tick_arrays_for_swap(pool, &pool_state(0, 1, &[-3, -1, 0, 2]), None, true, 2).unwrap();

        assert_eq!(
            selection.tick_arrays,
            vec![derive_tick_array(pool, 0), derive_tick_array(pool, -1)]
        );
    }

    #[test]
    fn merges_positive_extension_indexes() {
        let pool = Pubkey::new_unique();
        let extension = extension_state(&[512]);
        let mut state = pool_state(511 * 128, 1, &[511]);
        state.is_bitmap_extension_initialized = 1;
        let selection = tick_arrays_for_swap(pool, &state, Some(&extension), false, 3).unwrap();

        assert_eq!(
            selection.tick_arrays,
            vec![derive_tick_array(pool, 511), derive_tick_array(pool, 512),]
        );
        assert!(selection.requires_bitmap_extension);
    }

    #[test]
    fn merges_negative_extension_indexes() {
        let pool = Pubkey::new_unique();
        let extension = extension_state(&[-513]);
        let mut state = pool_state(-512 * 128, 1, &[-512]);
        state.is_bitmap_extension_initialized = 1;
        let selection = tick_arrays_for_swap(pool, &state, Some(&extension), true, 3).unwrap();

        assert_eq!(
            selection.tick_arrays,
            vec![derive_tick_array(pool, -512), derive_tick_array(pool, -513),]
        );
        assert!(selection.requires_bitmap_extension);
    }

    #[test]
    fn requires_extension_when_the_pool_flag_is_set() {
        let pool = Pubkey::new_unique();
        let mut state = pool_state(0, 1, &[0]);
        state.is_bitmap_extension_initialized = 1;
        let selection = tick_arrays_for_swap(pool, &state, None, true, 3).unwrap();
        assert!(selection.requires_bitmap_extension);
        assert_eq!(selection.tick_array_indexes, vec![0]);
    }

    #[test]
    fn does_not_require_a_missing_extension_when_the_current_index_slipped_outside() {
        let pool = Pubkey::new_unique();
        let state = pool_state(-512 * 128 - 1, 1, &[-512, -100]);
        let selection = tick_arrays_for_swap(pool, &state, None, false, 3).unwrap();
        assert!(!selection.requires_bitmap_extension);
        assert_eq!(selection.tick_array_indexes, vec![-512, -100]);
    }

    // Without an extension account there is no liquidity outside the internal
    // bitmap, but `tick_current_id` can still sit outside it because crossing a
    // tick moves the current id to `tick.tick_id - 1`. The program then resumes
    // the search from the internal boundary instead of giving up.
    #[test]
    fn traversal_without_extension_resumes_at_the_internal_boundary() {
        assert_eq!(
            pool_state(0, 1, &[100])
                .get_non_zero_liquidity_next_index(true, 600, None)
                .unwrap(),
            Some(100)
        );
        assert_eq!(
            pool_state(0, 1, &[-100])
                .get_non_zero_liquidity_next_index(false, -600, None)
                .unwrap(),
            Some(-100)
        );
    }

    #[test]
    fn traversal_without_extension_gives_up_when_leading_away() {
        let state = pool_state(0, 1, &[100]);
        assert_eq!(
            state
                .get_non_zero_liquidity_next_index(false, 600, None)
                .unwrap(),
            None
        );
        assert_eq!(
            state
                .get_non_zero_liquidity_next_index(true, -600, None)
                .unwrap(),
            None
        );
        assert_eq!(
            pool_state(0, 1, &[])
                .get_non_zero_liquidity_next_index(true, 600, None)
                .unwrap(),
            None
        );
    }
}
