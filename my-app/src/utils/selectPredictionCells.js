import { blockCenter } from "./makeForecastPixelGrid";

function parseKeyToRowCol(key) {
  if (!key) return null;
  const m = /^CA-(-?\d+)-(-?\d+)$/.exec(String(key));
  if (m) return { row: Number(m[1]), col: Number(m[2]) };
  const parts = String(key).split(",");
  if (parts.length === 2) {
    const row = Number(parts[0]);
    const col = Number(parts[1]);
    if (!Number.isNaN(row) && !Number.isNaN(col)) return { row, col };
  }
  return null;
}

function keyFor(row, col) {
  return `${row},${col}`;
}

function neighborCoords(row, col, includeDiagonals = false) {
  const out = [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 },
  ];
  if (includeDiagonals) {
    out.push(
      { row: row - 1, col: col - 1 },
      { row: row - 1, col: col + 1 },
      { row: row + 1, col: col - 1 },
      { row: row + 1, col: col + 1 }
    );
  }
  return out;
}

function getCellState(gridState, row, col) {
  if (!gridState) return null;
  const byKey = gridState instanceof Map ? gridState.get(keyFor(row, col)) : gridState[keyFor(row, col)] ?? gridState[`CA-${row}-${col}`];
  if (byKey) return byKey;
  return null;
}

export function selectPredictionCells(gridState, includeDiagonals = false) {
  const selected = [];

  const iterate = (fn) => {
    if (gridState instanceof Map) {
      for (const [key, val] of gridState.entries()) fn(key, val);
    } else {
      for (const key of Object.keys(gridState || {})) fn(key, gridState[key]);
    }
  };

  iterate((key, val) => {
    if (!val) return;
    const row = val.row ?? parseKeyToRowCol(key)?.row;
    const col = val.col ?? parseKeyToRowCol(key)?.col;
    if (row == null || col == null) return;

    const t = Number(val.t ?? 0);
    const t_burn = Number(val.t_burn ?? 0);
    if (!(t > 1)) return;

    const neighbors = neighborCoords(row, col, includeDiagonals);
    let touchesBurning = false;
    for (const n of neighbors) {
      const st = getCellState(gridState, n.row, n.col);
      if (st && Number(st.t_burn) === 1) { touchesBurning = true; break; }
    }
    if (!touchesBurning) return;

    const center = blockCenter(row, col);
    selected.push({ row, col, t, t_burn, centerLat: center.centerLat, centerLon: center.centerLon });
  });

  return selected;
}

export async function predictForSelectedCells(gridState, predictFn, { includeDiagonals = false, concurrency = 8 } = {}) {
  if (typeof predictFn !== "function") throw new Error("predictFn must be a function(cell)");
  const cells = selectPredictionCells(gridState, includeDiagonals);
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < cells.length) {
      const i = idx++;
      const cell = cells[i];
      try {
        const res = await predictFn(cell);
        results[i] = { ok: true, cell, res };
      } catch (e) {
        results[i] = { ok: false, cell, error: e };
      }
    }
  }

  const workers = Array(Math.max(1, concurrency)).fill(0).map(() => worker());
  await Promise.all(workers);
  return { cells, results };
}
