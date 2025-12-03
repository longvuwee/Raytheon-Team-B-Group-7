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
  let cells = new Map(); // key -> { row, col, prob, t, t_burn }
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

  // Simple fill: only fill small interior gaps (max 3x3 holes)
  // This prevents hollow squares without making things blurry
  const toFill = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const key = `${r},${c}`;
      if (cells.has(key)) continue;

      // Count how many of the 8 neighbors exist
      let neighborCount = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nKey = `${r + dr},${c + dc}`;
          if (cells.has(nKey)) neighborCount++;
        }
      }

      // Fill if surrounded by at least 6 out of 8 neighbors
      if (neighborCount >= 6) {
        toFill.push({ row: r, col: c });
      }
    }
  }

  // Add filled cells
  for (const { row, col } of toFill) {
    const key = `${row},${col}`;
    cells.set(key, { row, col, prob: 0.70, t: 1, t_burn: 1 });
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

  // Helper: color by probability using risk level colors
  function colorForCell(prob, t, t_burn) {
    // Color based on spread probability (risk levels)
    // High Risk (75-100%): Red
    // Medium Risk (50-75%): Orange  
    // Low Risk (25-50%): Yellow
    // Very Low (<25%): Light Yellow
    
    if (prob >= 0.75) {
      // High Risk: Red
      return `rgba(220, 38, 38, 0.9)`;
    } else if (prob >= 0.50) {
      // Medium Risk: Orange
      return `rgba(249, 115, 22, 0.85)`;
    } else if (prob >= 0.25) {
      // Low Risk: Yellow
      return `rgba(250, 204, 21, 0.75)`;
    } else {
      // Very Low Risk: Light Yellow
      const alpha = Math.max(0.4, prob * 2); // fade out for very low probabilities
      return `rgba(254, 240, 138, ${alpha})`;
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
