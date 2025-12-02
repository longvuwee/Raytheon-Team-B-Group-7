// Render predictions into a discrete pixel-grid raster (no blur).
// This mirrors the server's snap_to_grid logic so each canvas cell maps to a simulation block.
const ORIGIN_LAT = 25.0;
const ORIGIN_LON = -125.0;
const DEG_LAT_200FT = 61.0 / 111_320.0;
const DEG_LON_200FT_AT_EQ = 61.0 / 111_320.0;

function degLonAtLat(lat) {
  return DEG_LON_200FT_AT_EQ * Math.max(Math.cos((lat * Math.PI) / 180.0), 0.1);
}

export function snapToGrid(lat, lon) {
  const cellLat = DEG_LAT_200FT;
  const cellLon = DEG_LON_200FT_AT_EQ * Math.max(Math.cos((lat * Math.PI) / 180.0), 0.1);
  const row = Math.floor((lat - ORIGIN_LAT) / cellLat);
  const col = Math.floor((lon - ORIGIN_LON) / cellLon);
  const centerLat = ORIGIN_LAT + (row + 0.5) * cellLat;
  const centerLon = ORIGIN_LON + (col + 0.5) * cellLon;
  return { row, col, centerLat, centerLon };
}

function getLat(pred) {
  return pred.lat ?? pred.latitude ?? pred.latitude ?? null;
}
function getLon(pred) {
  return pred.lon ?? pred.longitude ?? pred.longitude ?? null;
}

export default function makeForecastPixelGrid(predictions = []) {
  if (!predictions || predictions.length === 0) return { imageDataUrl: null, bbox: null };

  // Map each prediction into a block row/col and keep max probability per cell
  const cells = new Map(); // key -> { row, col, prob, t, t_burn }
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;

  for (const p of predictions) {
    const lat = getLat(p);
    const lon = getLon(p);
    if (lat == null || lon == null) continue;
    const { row, col } = snapToGrid(lat, lon);
    const key = `${row},${col}`;
    const prob = Number(p.spread_probability ?? p.probability ?? p.last_prob ?? 0) || 0;
    const t = Number(p.t ?? 0) || 0;
    const t_burn = Number(p.t_burn ?? 0) || 0;
    const prev = cells.get(key);
    if (!prev || prob > prev.prob) {
      cells.set(key, { row, col, prob, t, t_burn });
    }
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }

  // Fill gaps: if a cell is surrounded by burning cells, make it burn too
  const burningCells = new Set();
  for (const [key, cell] of cells.entries()) {
    if (cell.t_burn === 1) {
      burningCells.add(key);
    }
  }

  // Find cells that should be filled (surrounded by burning cells)
  const toFill = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const key = `${r},${c}`;
      if (burningCells.has(key)) continue; // already burning

      // Check 8 neighbors
      let burningNeighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nKey = `${r + dr},${c + dc}`;
          if (burningCells.has(nKey)) burningNeighbors++;
        }
      }

      // If surrounded by 3+ burning neighbors, fill this gap
      if (burningNeighbors >= 3) {
        toFill.push({ row: r, col: c });
      }
    }
  }

  // Add filled cells
  for (const { row, col } of toFill) {
    const key = `${row},${col}`;
    if (!cells.has(key)) {
      cells.set(key, { row, col, prob: 0.8, t: 1, t_burn: 1 });
    }
  }

  if (cells.size === 0) return { imageDataUrl: null, bbox: null };

  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;

  // dynamic cell pixel size while keeping reasonable canvas sizes
  const maxCanvas = 1024;
  const minCellPx = 4;
  const cellPx = Math.max(minCellPx, Math.floor(Math.min(maxCanvas / cols, maxCanvas / rows)));
  const width = cols * cellPx;
  const height = rows * cellPx;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fill the background transparent
  ctx.clearRect(0, 0, width, height);

  // Helper: color by probability AND time (older burns get darker)
  function colorForCell(prob, t, t_burn) {
    // If not burning, use pale yellow with low opacity
    if (t_burn !== 1) {
      const a = Math.max(0.15, Math.min(0.5, prob));
      return `rgba(255,230,122,${a})`;
    }

    // For burning cells, darken based on t (time since ignition)
    // Higher t = darker color (longer burning = more charred)
    const ageFactor = Math.min(1.0, t / 8); // normalize to 0-1 over ~8 hours
    const brightness = 1.0 - (ageFactor * 0.6); // reduce brightness by up to 60%

    const a = Math.max(0.7, Math.min(0.95, prob)); // high opacity for burning
    
    // Color gradient: bright red → dark red → almost black
    if (ageFactor < 0.3) {
      // Fresh fire: bright red/orange
      const r = Math.floor(210 * brightness);
      const g = Math.floor(34 * brightness);
      const b = Math.floor(34 * brightness);
      return `rgba(${r},${g},${b},${a})`;
    } else if (ageFactor < 0.6) {
      // Medium age: darker red/brown
      const r = Math.floor(150 * brightness);
      const g = Math.floor(20 * brightness);
      const b = Math.floor(20 * brightness);
      return `rgba(${r},${g},${b},${a})`;
    } else {
      // Old fire: very dark red/black
      const r = Math.floor(80 * brightness);
      const g = Math.floor(10 * brightness);
      const b = Math.floor(10 * brightness);
      return `rgba(${r},${g},${b},${a})`;
    }
  }

  // Draw cells. Y axis: rows increase with latitude, so draw with top = maxRow
  for (const entry of cells.values()) {
    const { row: r, col: c, prob, t, t_burn } = entry;
    const x = (c - minCol) * cellPx;
    const y = (maxRow - r) * cellPx; // invert rows for canvas Y
    ctx.fillStyle = colorForCell(prob, t, t_burn);
    ctx.fillRect(x, y, cellPx, cellPx);
  }

  // Compute bbox: use corners derived from outer block centers minus/plus half cells
  // SW corner: (minRow, minCol)
  const swCenterLat = ORIGIN_LAT + (minRow + 0.5) * DEG_LAT_200FT;
  const swCellLon = degLonAtLat(swCenterLat);
  const swCenterLon = ORIGIN_LON + (minCol + 0.5) * swCellLon;
  const minLat = ORIGIN_LAT + minRow * DEG_LAT_200FT;
  const maxLat = ORIGIN_LAT + (maxRow + 1) * DEG_LAT_200FT;

  // For minLon use minCol at its row's lon width, and for maxLon use maxCol at its row
  const nwCenterLat = ORIGIN_LAT + (maxRow + 0.5) * DEG_LAT_200FT;
  const nwCellLon = degLonAtLat(nwCenterLat);
  const minLon = ORIGIN_LON + minCol * swCellLon;
  const maxLon = ORIGIN_LON + (maxCol + 1) * nwCellLon;

  const imageDataUrl = canvas.toDataURL('image/png');
  const bbox = [minLon, minLat, maxLon, maxLat];
  return { imageDataUrl, bbox };
}

export function blockCenter(row, col) {
  const centerLat = ORIGIN_LAT + (row + 0.5) * DEG_LAT_200FT;
  const cellLon = degLonAtLat(centerLat);
  const centerLon = ORIGIN_LON + (col + 0.5) * cellLon;
  return { centerLat, centerLon };
}
