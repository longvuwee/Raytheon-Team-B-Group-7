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

  // Map each prediction into a block row/col
  const cells = new Map();
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;

  for (const p of predictions) {
    const lat = getLat(p);
    const lon = getLon(p);
    if (lat == null || lon == null) continue;
    const { row, col } = snapToGrid(lat, lon);
    const key = `${row},${col}`;
    cells.set(key, { row, col });
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
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

  // Solid dark grey for initial ignition (non-transparent)
  ctx.fillStyle = '#333333';

  // Draw cells. Y axis: rows increase with latitude, so draw with top = maxRow
  for (const key of cells.keys()) {
    const [r, c] = key.split(',').map(Number);
    const x = (c - minCol) * cellPx;
    const y = (maxRow - r) * cellPx; // invert rows for canvas Y
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
