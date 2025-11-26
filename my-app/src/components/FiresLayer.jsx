import { useEffect } from "react";
import { Entity } from "@openglobus/og";
import makeSquareIcon from "../utils/dataPoints";
import filterClusteredOutliers from "../utils/filterClusters";

export default function FiresLayer({ globus, selectedDate }) {
  useEffect(() => {
    if (!globus) return;
    const layer = globus.planet.getLayerByName("Fires");
    if (!layer) return;

    const iconURL = makeSquareIcon(32);
    const MIN = 3, MAX = 22;
    const scale = h => Math.max(MIN, Math.min(MAX, Math.pow(Math.max(h*0.00002,1), -0.65)*40));
    let last = 10, entities = [], cancelled = false;

    const sync = () => {
      const px = scale(globus.planet.camera.getHeight());
      if (Math.abs(px - last) < 0.5) return;  // Only update when visually significant
      last = px; entities.forEach(e => e.billboard?.setSize(px, px));
    };
    const cam = globus.planet.camera;
    cam.events.off("move", sync); cam.events.off("zoom", sync); cam.events.on("moveend", sync);

    (async () => {
      try {
        // === Load points from Supabase ===
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
        if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${res.statusText}`);
        const rows = await res.json();

        // Parse rows into {lat, lon}
        const allPoints = rows
          .map((r) => {
            const lat = parseFloat(r.latitude);
            const lon = parseFloat(r.longitude);
            return isFinite(lat) && isFinite(lon) ? { lat, lon } : null;
          })
          .filter(Boolean);

        // Keep only clustered points (remove isolated points)
        const clustered = filterClusteredOutliers(allPoints, 5, 4);
        console.log(`FiresLayer: Loaded ${allPoints.length} points for ${startISO}, keeping ${clustered.length} clustered`);

        for (const p of clustered) {
          if (cancelled) break;
          const ent = new Entity({ lonlat:[p.lon, p.lat], billboard:{ src: iconURL, size:[last,last] }});
          layer.add(ent); 
          entities.push(ent);
        }
        sync();
      } catch(e) { console.error("Fires data load failed:", e); }
    })();

    return () => {
      cancelled = true;
      // Remove all entities when date changes
      entities.forEach(e => layer.remove(e));
      cam.events.off("move", sync); cam.events.off("zoom", sync); cam.events.off("moveend", sync);
    };
  }, [globus, selectedDate]);

  return null;
}
