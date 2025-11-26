import { useEffect } from "react";
import { Entity, Vector } from "@openglobus/og";
import makeSquareIcon from "../utils/dataPoints";
import filterClusteredOutliers from "../utils/filterClusters";

export default function FiresLayer({ globus, startDate, endDate }) {
  useEffect(() => {
    console.log("FiresLayer: useEffect triggered", { globus: !!globus, startDate, endDate });
    if (!globus) return;
    
    // Ensure the layer exists, create if missing
    let layer = globus.planet.getLayerByName("Fires");
    if (!layer) {
      console.warn("FiresLayer: 'Fires' layer not found, attempting to recreate it");
      layer = new Vector("Fires");
      globus.planet.addLayer(layer);
      console.log("FiresLayer: 'Fires' layer recreated");
    } else {
      console.log("FiresLayer: Fires layer found, proceeding to load data");
    }

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
        console.log("FiresLayer: Supabase config", { 
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
        console.log("FiresLayer: Fetching from", url);
        const res = await fetch(url, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Accept: "application/json",
          },
        });
        console.log("FiresLayer: Fetch response", { status: res.status, ok: res.ok });
        if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${res.statusText}`);
        const rows = await res.json();
        console.log("FiresLayer: Received rows", rows.length);

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
      // Remove all entities when date changes - ensure layer still exists
      const currentLayer = globus?.planet?.getLayerByName("Fires");
      if (currentLayer && entities.length > 0) {
        console.log(`FiresLayer: Cleaning up ${entities.length} entities`);
        entities.forEach(e => {
          try {
            currentLayer.remove(e);
          } catch (err) {
            // Ignore errors if entity already removed
          }
        });
      }
      cam.events.off("move", sync); cam.events.off("zoom", sync); cam.events.off("moveend", sync);
    };
  }, [globus, startDate, endDate]);

  return null;
}
