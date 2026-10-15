//! Tick-array selection for building instructions: the arrays holding given
//! ticks, and the arrays a swap traverses.
use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::*;

/// The tick arrays holding `tick_ids`, deduplicated and ascending by index,
/// the order the position and limit-order instructions take them in. For a
/// position, pass both endpoints of every range.
pub fn tick_arrays_for_tick_ids(
    pool: Pubkey,
    tick_ids: &[i32],
    tick_spacing: u16,
) -> Result<Vec<Pubkey>> {
    let indexes = tick_ids
        .iter()
        .map(|&tick_id| TickArray::get_tick_index_from_tick_id(tick_id, tick_spacing))
        .collect::<Result<BTreeSet<i32>>>()?;
    Ok(indexes
        .into_iter()
        .map(|index| derive_tick_array(pool, index))
        .collect())
}

/// Up to `max_tick_arrays` tick arrays holding liquidity, in the order `swap`
/// traverses them from the current tick: descending indices when
/// `swap_for_y`, ascending otherwise. Once the pool's bitmap extension is
/// initialized, pass it here and to `swap`.
pub fn tick_arrays_for_swap(
    pool_address: Pubkey,
    pool: &Pool,
    extension: Option<&TickArrayBitmapExtension>,
    swap_for_y: bool,
    max_tick_arrays: usize,
) -> Result<Vec<Pubkey>> {
    let mut tick_arrays = vec![];
    let mut from_index =
        TickArray::get_tick_index_from_tick_id(pool.tick_current_id, pool.tick_spacing)?;
    while tick_arrays.len() < max_tick_arrays {
        let Some(index) =
            pool.get_non_zero_liquidity_next_index(swap_for_y, from_index, extension)?
        else {
            break;
        };
        tick_arrays.push(derive_tick_array(pool_address, index));
        from_index = if swap_for_y {
            index.safe_sub(1)?
        } else {
            index.safe_add(1)?
        };
    }
    Ok(tick_arrays)
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

    fn with_extension(mut pool: Pool) -> Pool {
        pool.is_bitmap_extension_initialized = 1;
        pool
    }

    fn tick_arrays(pool: Pubkey, indexes: &[i32]) -> Vec<Pubkey> {
        indexes
            .iter()
            .map(|&index| derive_tick_array(pool, index))
            .collect()
    }

    #[test]
    fn tick_id_arrays_are_deduplicated_and_ascending() {
        let pool = Pubkey::new_unique();
        assert_eq!(
            tick_arrays_for_tick_ids(pool, &[300, -1, 5, 256], 2).unwrap(),
            tick_arrays(pool, &[-1, 0, 1])
        );
    }

    #[test]
    fn orders_arrays_descending_when_swapping_for_y() {
        let pool = Pubkey::new_unique();
        let state = pool_state(0, 1, &[-3, -1, 0, 2]);
        assert_eq!(
            tick_arrays_for_swap(pool, &state, None, true, 3).unwrap(),
            tick_arrays(pool, &[0, -1, -3])
        );
        assert_eq!(
            tick_arrays_for_swap(pool, &state, None, true, 2).unwrap(),
            tick_arrays(pool, &[0, -1])
        );
    }

    #[test]
    fn orders_arrays_ascending_when_swapping_for_x() {
        let pool = Pubkey::new_unique();
        assert_eq!(
            tick_arrays_for_swap(pool, &pool_state(0, 1, &[-3, -1, 0, 2]), None, false, 3).unwrap(),
            tick_arrays(pool, &[0, 2])
        );
    }

    #[test]
    fn continues_into_every_extension_offset() {
        let pool = Pubkey::new_unique();
        let extension = extension_state(&[-3000, -2000, -513, 512, 1100, 3000]);
        let state = with_extension(pool_state(0, 1, &[0]));
        assert_eq!(
            tick_arrays_for_swap(pool, &state, Some(&extension), false, 10).unwrap(),
            tick_arrays(pool, &[0, 512, 1100, 3000])
        );
        assert_eq!(
            tick_arrays_for_swap(pool, &state, Some(&extension), true, 10).unwrap(),
            tick_arrays(pool, &[0, -513, -2000, -3000])
        );
    }

    #[test]
    fn needs_the_extension_once_the_pool_has_one() {
        let state = with_extension(pool_state(0, 1, &[0]));
        assert_eq!(
            tick_arrays_for_swap(Pubkey::new_unique(), &state, None, true, 3).unwrap_err(),
            PoolError::BitmapExtensionAccountIsNotProvided.into()
        );
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
