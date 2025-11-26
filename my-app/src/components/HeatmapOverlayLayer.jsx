import { useEffect } from "react";
import { GeoImage, LonLat } from "@openglobus/og";
import makeDensityHeatmap from "../utils/makeDensityHeatMap";

export default function HeatmapOverlayLayer({ globeRef, startDate, endDate }) {
  useEffect(() => {
    console.log("HeatmapOverlay: useEffect triggered", { 
      hasGlobeRef: !!globeRef?.current,
      startDate,
      endDate
    });
    const globus = globeRef.current?.getGlobus?.();
    console.log("HeatmapOverlay: globus obtained", { hasGlobus: !!globus });
    if (!globus) return;
    let cancelled = false;
    let heatmapLayer = null;

    (async () => {
      try {
        // === 1. Load points from Supabase ===
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
        console.log("HeatmapOverlay: Supabase config", { 
          hasUrl: !!SUPABASE_URL, 
          hasKey: !!SUPABASE_ANON_KEY,
          url: SUPABASE_URL 
        });
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          console.error("Supabase not configured (VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing)");
          return;
        }

        // Build date filter: use provided date range
        const startISO = new Date(startDate).toISOString().replace('T', ' ').substring(0, 19);
        const endISO = new Date(endDate).toISOString().replace('T', ' ').substring(0, 19);

        const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/fires?select=latitude,longitude&datetime=gte.${startISO}&datetime=lt.${endISO}`;
        console.log("HeatmapOverlay: Fetching from", url);
        const res = await fetch(url, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Accept: "application/json",
          },
        });
        console.log("HeatmapOverlay: Fetch response", { status: res.status, ok: res.ok });
        if (!res.ok) {
          throw new Error(`Supabase fetch failed: ${res.status} ${res.statusText}`);
        }
        const rows = await res.json();
        console.log("HeatmapOverlay: Received rows", rows.length);
        const pts = rows
          .map((r) => {
            const lat = parseFloat(r.latitude);
            const lon = parseFloat(r.longitude);
            return isFinite(lat) && isFinite(lon) ? { lon, lat } : null;
          })
          .filter(Boolean);
        
        console.log(`HeatmapOverlay: Loaded ${pts.length} points for ${startISO}`);
        if (!pts.length || cancelled) return;


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
  }, [globeRef, startDate, endDate]);

  return null;
}
