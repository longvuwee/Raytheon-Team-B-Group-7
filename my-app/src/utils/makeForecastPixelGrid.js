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

export default function makeForecastPixelGrid(predictions = [], options = {}) {
  const burnedCells = options && options.burnedCells ? options.burnedCells : null; // Set of "row,col"
  if (!predictions || predictions.length === 0) return { imageDataUrl: null, bbox: null };

  // Map each prediction into a block row/col and keep max probability per cell
  const cells = new Map(); // key -> { row, col, prob }
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;

  for (const p of predictions) {
    const lat = getLat(p);
    const lon = getLon(p);
    if (lat == null || lon == null) continue;
    const { row, col } = snapToGrid(lat, lon);
    const key = `${row},${col}`;
    const prob = Number(p.spread_probability ?? p.probability ?? p.last_prob ?? 0) || 0;
    const prev = cells.get(key);
    if (!prev || prob > prev.prob) {
      cells.set(key, { row, col, prob });
    }
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }

  // Extend extents to include burned cells so bbox covers them
  if (burnedCells && burnedCells.size) {
    for (const key of burnedCells) {
      const [rStr, cStr] = key.split(",");
      const r = Number(rStr), c = Number(cStr);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
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

  // Helper: color by probability with a minimum opacity to ensure visibility
  function colorForProb(prob) {
    const a = Math.max(0.25, Math.min(0.95, prob)); // clamp alpha
    if (prob >= 0.75) return `rgba(210,34,34,${a})`;      // red
    if (prob >= 0.50) return `rgba(255,136,0,${a})`;      // orange
    if (prob >= 0.25) return `rgba(255,196,0,${a})`;      // yellow
    return `rgba(255,230,122,${a * 0.8})`;                // pale yellow
  }

  // Draw: first burned cells (grey), then active/burning (colored)
  const drawCell = (r, c, style) => {
    const x = (c - minCol) * cellPx;
    const y = (maxRow - r) * cellPx;
    ctx.fillStyle = style;
    ctx.fillRect(x, y, cellPx, cellPx);
  };

  if (burnedCells && burnedCells.size) {
    const grey = 'rgba(96,96,96,0.8)';
    for (const key of burnedCells) {
      const [rStr, cStr] = key.split(",");
      const r = Number(rStr), c = Number(cStr);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      drawCell(r, c, grey);
    }
  }

  // Y axis: rows increase with latitude, so draw with top = maxRow
  for (const entry of cells.values()) {
    const { row: r, col: c, prob } = entry;
    drawCell(r, c, colorForProb(prob));
  }

  // Compute bbox: use corners derived from outer block centers minus/plus half cells
  // SW corner: (minRow, minCol)
  const swCenterLat = ORIGIN_LAT + (minRow + 0.5) * DEG_LAT_200FT;
  const swCellLon = degLonAtLat(swCenterLat);
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
