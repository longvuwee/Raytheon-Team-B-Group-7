import { useEffect } from "react";
import { GeoImage, LonLat } from "@openglobus/og";
import makeDensityHeatmap from "../utils/makeDensityHeatMap";

export default function HeatmapOverlayLayer({ globeRef }) {
  useEffect(() => {
    const globus = globeRef.current?.getGlobus?.();
    if (!globus) return;
    let cancelled = false;

    (async () => {
      try {
        // === 1. Load your CSV ===
        const res = await fetch("/data/fires_labeled_with_perimeter_labels.csv");
        const text = await res.text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) return;

        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const latIdx = headers.findIndex((h) =>
          ["latitude", "lat", "lat_dd"].includes(h)
        );
        const lonIdx = headers.findIndex((h) =>
          ["longitude", "lon", "lon_dd"].includes(h)
        );
        if (latIdx === -1 || lonIdx === -1) {
          console.warn("CSV missing latitude/longitude headers for heatmap layer");
          return;
        }

        // === 2. Parse points ===
        const pts = [];
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].split(",");
          const lat = parseFloat(row[latIdx]);
          const lon = parseFloat(row[lonIdx]);
          if (isFinite(lat) && isFinite(lon)) pts.push({ lon, lat });
        }
        if (!pts.length || cancelled) return;

        // === 3. Generate one heatmap image from points ===
        const { imageDataUrl, bbox } = makeDensityHeatmap(pts);
        if (!imageDataUrl || !bbox) {
          console.warn("Heatmap generation failed");
          return;
        }

        const [minLon, minLat, maxLon, maxLat] = bbox;

        // === 4. Create GeoImage overlay ===
        const heatmapImage = new GeoImage("Wildfire Heatmap", {
          src: imageDataUrl, // dynamically generated PNG
          corners: [
            [minLon, minLat],
            [maxLon, minLat],
            [maxLon, maxLat],
            [minLon, maxLat],
          ],
          visibility: true,
          isBaseLayer: false,
          attribution: "Dynamic Heatmap Overlay",
          opacity: 0.85,
        });

        // === 5. Add it above base layers ===
        globus.planet.addLayer(heatmapImage);
        const planet = globus.planet;
        planet.removeLayer(heatmapImage);
        planet.addLayer(heatmapImage);

        // === 6. Center camera on data ===
        const midLon = (minLon + maxLon) / 2;
        const midLat = (minLat + maxLat) / 2;
        planet.camera.flyLonLat(new LonLat(midLon, midLat, 1500000));

        console.log("✅ Heatmap overlay added successfully.");
      } catch (err) {
        console.error("❌ Heatmap overlay failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [globeRef]);

  return null;
}
