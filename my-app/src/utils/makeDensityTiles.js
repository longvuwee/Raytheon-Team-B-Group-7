export default function makeDensityTiles(points, opts = {}) {
  // opts: { radiusPx=12, tilesX=4, tilesY=4, getWeight=(p)=>1 }
  const radiusPx = opts.radiusPx ?? 18;
  const tilesX = opts.tilesX ?? 4;
  const tilesY = opts.tilesY ?? 4;
  const getWeight = opts.getWeight ?? (() => 1);

  if (!points.length) return { tiles: [], bounds: null };

  // bounds
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const padLon = 0.5, padLat = 0.5;
  minLon -= padLon; maxLon += padLon;
  minLat -= padLat; maxLat += padLat;

  const WIDTH = 512;
  const HEIGHT = Math.max(
    256,
    Math.round(((maxLat - minLat) / (maxLon - minLon || 1)) * WIDTH)
  );

  const grid = new Float32Array(WIDTH * HEIGHT);

  function toPixel(lon, lat) {
    const x = ((lon - minLon) / (maxLon - minLon)) * (WIDTH - 1);
    const y = ((maxLat - lat) / (maxLat - minLat)) * (HEIGHT - 1);
    return { x, y };
  }

  // gaussian-ish kernel
  const kernelRadiusPx = Math.max(2, Math.floor(radiusPx));
  const kernelSize = kernelRadiusPx * 2 + 1;
  const kernel = new Float32Array(kernelSize * kernelSize);
  const sigma = kernelRadiusPx * 0.6;
  for (let ky = -kernelRadiusPx; ky <= kernelRadiusPx; ky++) {
    for (let kx = -kernelRadiusPx; kx <= kernelRadiusPx; kx++) {
      const d2 = kx * kx + ky * ky;
      const falloff = Math.exp(-d2 / (2 * sigma * sigma));
      kernel[(ky + kernelRadiusPx) * kernelSize + (kx + kernelRadiusPx)] = falloff;
    }
  }

  // accumulate with weights
  for (const p of points) {
    const w = Math.max(0, getWeight(p) || 0);
    if (w === 0) continue;
    const { x, y } = toPixel(p.lon, p.lat);
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let ky = -kernelRadiusPx; ky <= kernelRadiusPx; ky++) {
      const py = cy + ky;
      if (py < 0 || py >= HEIGHT) continue;
      for (let kx = -kernelRadiusPx; kx <= kernelRadiusPx; kx++) {
        const px = cx + kx;
        if (px < 0 || px >= WIDTH) continue;
        const kval = kernel[(ky + kernelRadiusPx) * kernelSize + (kx + kernelRadiusPx)];
        grid[py * WIDTH + px] += kval * w;
      }
    }
  }

  // normalize
  let maxVal = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] > maxVal) maxVal = grid[i];

  // color ramp similar to Google (blue→cyan→yellow→red, alpha with intensity)
  function rampRGBA(v) {
    let r, g, b;
    if (v < 0.33) { const t = v / 0.33; r = 0; g = 128 + t * (255 - 128); b = 255 - t * 255; }
    else if (v < 0.66) { const t = (v - 0.33) / 0.33; r = t * 255; g = 255; b = 0; }
    else { const t = (v - 0.66) / 0.34; r = 255; g = 255 - t * 200; b = 0; }
    const a = Math.round(v * 225); // more visible
    return [r|0, g|0, b|0, a];
  }

  // draw full raster
  const fullCan = document.createElement("canvas");
  fullCan.width = WIDTH; fullCan.height = HEIGHT;
  const ctx = fullCan.getContext("2d");
  const img = ctx.createImageData(WIDTH, HEIGHT);
  const data = img.data;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] / (maxVal || 1);
    const [r,g,b,a] = rampRGBA(v);
    const idx = i * 4;
    data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = a;
  }
  ctx.putImageData(img, 0, 0);

  // slice into tiles
  const tileW = Math.floor(WIDTH / tilesX);
  const tileH = Math.floor(HEIGHT / tilesY);
  const tiles = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const sx = tx * tileW, sy = ty * tileH;
      const tileCan = document.createElement("canvas");
      tileCan.width = tileW; tileCan.height = tileH;
      tileCan.getContext("2d").drawImage(fullCan, sx, sy, tileW, tileH, 0, 0, tileW, tileH);
      const url = tileCan.toDataURL("image/png");

      const tileMinLon = minLon + (tx / tilesX) * (maxLon - minLon);
      const tileMaxLon = minLon + ((tx + 1) / tilesX) * (maxLon - minLon);
      const tileMaxLat = maxLat - (ty / tilesY) * (maxLat - minLat);
      const tileMinLat = maxLat - ((ty + 1) / tilesY) * (maxLat - minLat);

      tiles.push({ url, bbox: [tileMinLon, tileMinLat, tileMaxLon, tileMaxLat] });
    }
  }

  return { tiles, bounds: [minLon, minLat, maxLon, maxLat] };
}
