import { useEffect } from "react";
import { GeoImage, LonLat } from "@openglobus/og";
import makeDensityHeatmap from "../utils/makeDensityHeatMap";

export default function HeatmapOverlayLayer({ globeRef, selectedDate }) {
  useEffect(() => {
    const globus = globeRef.current?.getGlobus?.();
    if (!globus) return;
    let cancelled = false;
    let heatmapLayer = null;

    (async () => {
      try {
        // === 1. Load points from Supabase ===
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          console.error("Supabase not configured (VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing)");
          return;
        }

        // Build date filter: 1-hour window from selectedDate
        const startDate = new Date(selectedDate);
        const endDate = new Date(selectedDate.getTime() + 3600000); // +1 hour
        const startISO = startDate.toISOString().replace('T', ' ').substring(0, 19);
        const endISO = endDate.toISOString().replace('T', ' ').substring(0, 19);

        const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/fires?select=latitude,longitude&datetime=gte.${startISO}&datetime=lt.${endISO}`;
        const res = await fetch(url, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          throw new Error(`Supabase fetch failed: ${res.status} ${res.statusText}`);
        }
        const rows = await res.json();
        const pts = rows
          .map((r) => {
            const lat = parseFloat(r.latitude);
            const lon = parseFloat(r.longitude);
            return isFinite(lat) && isFinite(lon) ? { lon, lat } : null;
          })
          .filter(Boolean);
        
        console.log(`HeatmapOverlay: Loaded ${pts.length} points for ${startISO}`);
        if (!pts.length || cancelled) return;

        /*
         If you want to use the local CSV during preview instead of Supabase,
         uncomment the block below and comment out the Supabase fetch above.

        // === Local CSV fallback (commented on purpose) ===
        // const res = await fetch("/data/fires_labeled_with_perimeter_labels.csv");
        // const text = await res.text();
        // const lines = text.split(/\r?\n/).filter(Boolean);
        // if (lines.length < 2) return;
        // const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        // const latIdx = headers.findIndex((h) => ["latitude", "lat", "lat_dd"].includes(h));
        // const lonIdx = headers.findIndex((h) => ["longitude", "lon", "lon_dd"].includes(h));
        // if (latIdx === -1 || lonIdx === -1) return;
        // const pts = [];
        // for (let i = 1; i < lines.length; i++) {
        //   const row = lines[i].split(",");
        //   const lat = parseFloat(row[latIdx]);
        //   const lon = parseFloat(row[lonIdx]);
        //   if (isFinite(lat) && isFinite(lon)) pts.push({ lon, lat });
        // }
        */

        // === 3. Generate one heatmap image from points ===
        const { imageDataUrl, bbox } = makeDensityHeatmap(pts);
        if (!imageDataUrl || !bbox) {
          console.warn("Heatmap generation failed");
          return;
        }

        const [minLon, minLat, maxLon, maxLat] = bbox;

        // === 4. Create GeoImage overlay ===
        heatmapLayer = new GeoImage("Wildfire Heatmap", {
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
        globus.planet.addLayer(heatmapLayer);
        const planet = globus.planet;
        planet.removeLayer(heatmapLayer);
        planet.addLayer(heatmapLayer);

        // === 6. Center camera on data (only on first load) ===
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
      // Remove heatmap layer when date changes
      if (heatmapLayer && globus?.planet) {
        globus.planet.removeLayer(heatmapLayer);
      }
    };
  }, [globeRef, selectedDate]);

  return null;
}
