// src/globe/fireGlobe.js
import * as og from "openglobus";

/**
 * Map probability + T_burn to RGBA color.
 */
export function probToColor(prob, T_burn) {
  // cannot burn
  if (T_burn === 3) return [0.2, 0.2, 1.0, 0.9];
  // burned out
  if (T_burn === 2) return [0.5, 0.5, 0.5, 0.7];

  // active / possible burning
  if (prob < 0.25) return [0.0, 0.7, 0.0, 0.7];   // low risk
  if (prob < 0.5) return [0.8, 0.8, 0.0, 0.7];   // medium
  if (prob < 0.75) return [1.0, 0.5, 0.0, 0.8];  // high
  return [1.0, 0.0, 0.0, 0.9];                   // very high
}

export async function createFireGlobe(container) {
  const globe = new og.Globe({
    target: container,
    name: "FirecastGlobe",
  });

  const fireLayer = new og.layer.Vector("fire-heat", {
    clampToGround: true,
  });

  globe.planet.addLayer(fireLayer);

  return { globe, fireLayer };
}

export function renderBlocksOnLayer(fireLayer, blocks) {
  fireLayer.removeEntities();

  blocks.forEach((b) => {
    const color = probToColor(b.prob, b.T_burn);
    fireLayer.add(
      new og.Entity({
        lonlat: [b.lon, b.lat],
        style: {
          pointSize: 10,
          fillColor: color,
          opacity: 0.9,
        },
        properties: {
          block_id: b.block_id,
          prob: b.prob,
          T: b.T,
          T_burn: b.T_burn,
        },
      })
    );
  });
}
