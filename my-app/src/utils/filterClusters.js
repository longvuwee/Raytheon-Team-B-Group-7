/**
 * Haversine distance: calculate miles between two lat/lon points
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * filterClusteredOutliers(points, radius, minClusterSize)
 * 
 * Keep ONLY points that have >= minClusterSize neighbors within `radius` miles
 * (i.e., remove isolated points, keep clusters)
 * 
 * @param {Array} points - [{lat, lon}, ...]
 * @param {number} radiusMiles - Search radius (default 5 miles)
 * @param {number} minClusterSize - Threshold for cluster (default 4)
 * @returns {Array} filtered points (only clustered ones)
 */
export default function filterClusteredOutliers(
  points,
  radiusMiles = 5,
  minClusterSize = 4
) {
  if (!points || points.length < 2) return points;

  const cellSize = radiusMiles / 2; // Grid cell size for spatial hashing
  const grid = new Map(); // cell key → point indices

  // === 1. Build spatial grid ===
  for (let i = 0; i < points.length; i++) {
    const { lat, lon } = points[i];
    const cellKey = `${Math.floor(lat / cellSize)},${Math.floor(lon / cellSize)}`;
    
    if (!grid.has(cellKey)) {
      grid.set(cellKey, []);
    }
    grid.get(cellKey).push(i);
  }

  // === 2. For each point, count neighbors within radius ===
  const toKeep = new Set();

  for (let i = 0; i < points.length; i++) {
    const { lat, lon } = points[i];
    const cellKey = `${Math.floor(lat / cellSize)},${Math.floor(lon / cellSize)}`;
    const [cellLat, cellLon] = cellKey.split(",").map(Number);

    // Check this cell and 8 adjacent cells
    let neighborCount = 0;
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const neighborKey = `${cellLat + dLat},${cellLon + dLon}`;
        const cellIndices = grid.get(neighborKey) || [];
        
        for (const j of cellIndices) {
          if (i === j) continue; // Skip self
          const { lat: lat2, lon: lon2 } = points[j];
          const dist = haversineDistance(lat, lon, lat2, lon2);
          
          if (dist <= radiusMiles) {
            neighborCount++;
          }
        }
      }
    }

    // Keep if IN a dense cluster
    // (i.e., has >= minClusterSize neighbors)
    if (neighborCount >= minClusterSize) {
      toKeep.add(i);
    }
  }

  // === 3. Return filtered points ===
  return points.filter((_, i) => toKeep.has(i));
}
