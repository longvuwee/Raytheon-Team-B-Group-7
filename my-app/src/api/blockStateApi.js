import { supabase } from "./supabaseClient";
import { selectPredictionCells, predictForSelectedCells } from "../utils/selectPredictionCells";

export async function fetchFireCellStateNeighborhood(blockRow, blockCol, radius = 1) {
  const r0 = Number(blockRow);
  const c0 = Number(blockCol);
  const rMin = r0 - radius;
  const rMax = r0 + radius;
  const cMin = c0 - radius;
  const cMax = c0 + radius;

  const { data, error } = await supabase
    .from("fire_cell_state")
    .select(
      "block_row, block_col, block_id, last_latitude, last_longitude, t, t_burn, last_prob, prob_sum, prob_count, instant_spread_probability"
    )
    .gte("block_row", rMin)
    .lte("block_row", rMax)
    .gte("block_col", cMin)
    .lte("block_col", cMax);

  if (error) throw error;
  return data || [];
}

export function rowsToGridState(rows) {
  const grid = new Map();
  for (const row of rows) {
    const r = Number(row.block_row);
    const c = Number(row.block_col);
    const key = `${r},${c}`;
    grid.set(key, {
      row: r,
      col: c,
      t: Number(row.t ?? 0),
      t_burn: Number(row.t_burn ?? 0),
      last_prob: Number(row.last_prob ?? row.instant_spread_probability ?? 0),
      block_id: row.block_id,
      lat: Number(row.last_latitude ?? 0),
      lon: Number(row.last_longitude ?? 0),
      prob_sum: Number(row.prob_sum ?? 0),
      prob_count: Number(row.prob_count ?? 0),
    });
  }
  return grid;
}

export async function selectAndPredictNeighborhood({ blockRow, blockCol, radius = 1, includeDiagonals = false, concurrency = 8 }, predictFn) {
  const rows = await fetchFireCellStateNeighborhood(blockRow, blockCol, radius);
  const grid = rowsToGridState(rows);
  const { cells, results } = await predictForSelectedCells(grid, predictFn, { includeDiagonals, concurrency });
  return { cells, results };
}
