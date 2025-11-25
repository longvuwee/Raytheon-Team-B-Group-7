// makeDensityHeatmap(points)
// points: [{lon, lat}, ...]
// returns { imageDataUrl, bbox }
//  - imageDataUrl: "data:image/png;base64,..."
//  - bbox: [minLon, minLat, maxLon, maxLat] where to place it on globe

export default function makeDensityHeatmap(points) {
  if (!points.length) {
    return { imageDataUrl: null, bbox: null };
  }

  // 1. Get bounds of the points (so we only render that region, not whole Earth)
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }

  // pad a little so blob doesn't clip at edges
  const padLon = 0.2;
  const padLat = 0.2;
  minLon -= padLon;
  maxLon += padLon;
  minLat -= padLat;
  maxLat += padLat;

  // 2. Choose raster resolution
  // Higher = smoother but heavier.
  const WIDTH = 512;
  const HEIGHT = Math.max(256, Math.round((HEIGHTfromBounds(minLat, maxLat, minLon, maxLon, WIDTH))));

  function HEIGHTfromBounds(minLat, maxLat, minLon, maxLon, w) {
    // keep aspect ratio in lon/lat space
    const lonSpan = maxLon - minLon;
    const latSpan = maxLat - minLat;
    if (lonSpan === 0) return w;
    return Math.round((latSpan / lonSpan) * w);
  }

  const h = HEIGHT;

  // 3. Create an accumulator grid
  const grid = new Float32Array(WIDTH * h);

  // helper to map lon/lat -> pixel
  function toPixel(lon, lat) {
    const x = ((lon - minLon) / (maxLon - minLon)) * (WIDTH - 1);
    //const y = ((maxLat - lat) / (maxLat - minLat)) * (h - 1); // top-down
    // Keep latitude increasing upward (no flip)
    const y = ((lat - minLat) / (maxLat - minLat)) * (h - 1);

    return { x, y };
  }

  // 4. "splat" each point into the grid with a Gaussian-ish kernel
  // kernelRadiusPx controls how wide clusters bleed
  const kernelRadiusPx = 8;
  const kernelSize = kernelRadiusPx * 2 + 1;
  const kernel = new Float32Array(kernelSize * kernelSize);

  // precompute radial falloff
  for (let ky = -kernelRadiusPx; ky <= kernelRadiusPx; ky++) {
    for (let kx = -kernelRadiusPx; kx <= kernelRadiusPx; kx++) {
      const dist = Math.sqrt(kx * kx + ky * ky);
      // simple smooth falloff (Gaussian-ish)
      const falloff = Math.exp(-(dist * dist) / (2 * (kernelRadiusPx * 0.6) ** 2));
      kernel[(ky + kernelRadiusPx) * kernelSize + (kx + kernelRadiusPx)] = falloff;
    }
  }

  // splat points
  for (const p of points) {
    const { x, y } = toPixel(p.lon, p.lat);
    const cx = Math.round(x);
    const cy = Math.round(y);

    for (let ky = -kernelRadiusPx; ky <= kernelRadiusPx; ky++) {
      const py = cy + ky;
      if (py < 0 || py >= h) continue;
      for (let kx = -kernelRadiusPx; kx <= kernelRadiusPx; kx++) {
        const px = cx + kx;
        if (px < 0 || px >= WIDTH) continue;
        const kval = kernel[(ky + kernelRadiusPx) * kernelSize + (kx + kernelRadiusPx)];
        grid[py * WIDTH + px] += kval;
      }
    }
  }

  // 5. Normalize and colorize
  let maxVal = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > maxVal) maxVal = grid[i];
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(WIDTH, h);
  const data = img.data;

  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] / (maxVal || 1); // 0..1
    const { r, g, b, a } = rampRGBA(v);
    const idx = i * 4;
    data[idx + 0] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  }

  ctx.putImageData(img, 0, 0);

  // 6. Return PNG and bounding box
  return {
    imageDataUrl: canvas.toDataURL("image/png"),
    bbox: [minLon, minLat, maxLon, maxLat],
  };

  // helper: map 0..1 -> heatmap colors w/ alpha
  function rampRGBA(v) {
  // amplify brightness
  v = Math.pow(v, 0.5); // boosts low values
  let r, g, b;
  if (v < 0.33) {
    const t = v / 0.33;
    r = 0;
    g = 128 + t * (255 - 128);
    b = 255;
  } else if (v < 0.66) {
    const t = (v - 0.33) / 0.33;
    r = t * 255;
    g = 255;
    b = 0;
  } else {
    const t = (v - 0.66) / 0.34;
    r = 255;
    g = 255 - t * 200;
    b = 0;
  }
  const a = Math.min(255, Math.round(v * 255)); // full opacity for strong signal
  return { r, g, b, a };
}

}
