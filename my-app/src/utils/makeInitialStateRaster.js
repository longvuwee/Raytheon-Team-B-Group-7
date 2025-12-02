// Build a binary raster mask from a set of fire points.
// Approach: compute a convex hull of the points, then fill grid cells whose centers
// fall inside the hull polygon using the same 200ft grid as prediction frames.

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
  return { row, col };
}

export function blockCenter(row, col) {
  const centerLat = ORIGIN_LAT + (row + 0.5) * DEG_LAT_200FT;
  const cellLon = degLonAtLat(centerLat);
  const centerLon = ORIGIN_LON + (col + 0.5) * cellLon;
  return { centerLat, centerLon };
}

function convexHullLonLat(points) {
  // points: Array<{lat, lon}>
  // Use Andrew's monotone chain on (x=lon, y=lat)
  if (!points || points.length < 3) return points || [];
  const P = points
    .map((p) => ({ x: Number(p.lon), y: Number(p.lat) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (P.length < 3) return points;

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  return hull.map((h) => ({ lon: h.x, lat: h.y }));
}

function pointInPolygonLonLat(pt, poly) {
  // Ray casting, pt: {lat,lon}, poly: Array<{lat,lon}>
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon, yi = poly[i].lat;
    const xj = poly[j].lon, yj = poly[j].lat;
    const intersect = yi > pt.lat !== yj > pt.lat && pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export default function makeInitialStateRaster(points = []) {
  const pts = (points || []).map((p) => ({ lat: Number(p.lat ?? p.latitude), lon: Number(p.lon ?? p.longitude) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length === 0) return { imageDataUrl: null, bbox: null };

  const hull = convexHullLonLat(pts);
  if (!hull || hull.length < 3) return { imageDataUrl: null, bbox: null };

  // Determine grid bounds from points
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const p of pts) {
    const { row, col } = snapToGrid(p.lat, p.lon);
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }
  if (!Number.isFinite(minRow)) return { imageDataUrl: null, bbox: null };

  // Add a small margin
  const M = 1;
  minRow -= M; maxRow += M; minCol -= M; maxCol += M;

  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;

  const maxCanvas = 1024;
  const minCellPx = 4;
  const cellPx = Math.max(minCellPx, Math.floor(Math.min(maxCanvas / cols, maxCanvas / rows)));
  const width = cols * cellPx;
  const height = rows * cellPx;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  // Fill interior cells
  ctx.fillStyle = 'rgba(210,34,34,0.55)';
  const cells = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const { centerLat, centerLon } = blockCenter(r, c);
      if (pointInPolygonLonLat({ lat: centerLat, lon: centerLon }, hull)) {
        const x = (c - minCol) * cellPx;
        const y = (maxRow - r) * cellPx;
        ctx.fillRect(x, y, cellPx, cellPx);
        cells.push({ row: r, col: c, centerLat, centerLon });
      }
    }
  }

  // Note: perimeter outline intentionally omitted to avoid drawing a border

  // Compute bbox
  const swCenterLat = ORIGIN_LAT + (minRow + 0.5) * DEG_LAT_200FT;
  const swCellLon = degLonAtLat(swCenterLat);
  const minLat = ORIGIN_LAT + minRow * DEG_LAT_200FT;
  const maxLat = ORIGIN_LAT + (maxRow + 1) * DEG_LAT_200FT;
  const minLon = ORIGIN_LON + minCol * swCellLon;
  const nwCenterLat = ORIGIN_LAT + (maxRow + 0.5) * DEG_LAT_200FT;
  const nwCellLon = degLonAtLat(nwCenterLat);
  const maxLon = ORIGIN_LON + (maxCol + 1) * nwCellLon;

  return { imageDataUrl: canvas.toDataURL('image/png'), bbox: [minLon, minLat, maxLon, maxLat], cells };
}
