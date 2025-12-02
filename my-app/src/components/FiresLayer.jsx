import { useEffect } from "react";
import { Entity, Vector } from "@openglobus/og";
import makeSquareIcon from "../utils/dataPoints";
import filterClusteredOutliers from "../utils/filterClusters";

// Helper function to find nearby points within a radius (in degrees)
function findNearbyPoints(centerPoint, allPoints, radiusDegrees) {
  return allPoints.filter(p => {
    const dLat = p.lat - centerPoint.lat;
    const dLon = p.lon - centerPoint.lon;
    const distance = Math.sqrt(dLat * dLat + dLon * dLon);
    return distance <= radiusDegrees;
  });
}

export default function FiresLayer({ globus, startDate, endDate, onClusterClick }) {
  useEffect(() => {
    console.log("FiresLayer: useEffect triggered", { globus: !!globus, startDate, endDate });
    if (!globus) return;
    
    // Ensure the layer exists, create if missing
    let layer = globus.planet.getLayerByName("Fires");
    if (!layer) {
      console.warn("FiresLayer: 'Fires' layer not found, creating it");
      layer = new Vector("Fires");
      globus.planet.addLayer(layer);
      console.log("FiresLayer: 'Fires' layer created");
    } else {
      console.log("FiresLayer: Fires layer found");
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
    cam.events.on("moveend", sync);

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

        // Store all points with their data for cluster detection
        const pointsWithData = clustered.map(p => ({ ...p, ...rows.find(r => 
          parseFloat(r.latitude) === p.lat && parseFloat(r.longitude) === p.lon
        )}));

        for (const p of clustered) {
          if (cancelled) break;
          const ent = new Entity({ 
            lonlat:[p.lon, p.lat], 
            billboard:{ src: iconURL, size:[last,last] },
            properties: { lat: p.lat, lon: p.lon }
          });
          layer.add(ent); 
          entities.push(ent);
        }
        console.log(`FiresLayer: Added ${entities.length} entities`);
        sync();

        // Use globe-level click detection instead of per-entity events
        if (onClusterClick) {
          const clickHandler = (e) => {
            // Check if we clicked on an entity from the Fires layer
            if (!e.pickingObject) return;
            
            const clickedEntity = e.pickingObject;
            if (!clickedEntity._layer || clickedEntity._layer.name !== "Fires") return;
            
            console.log("FiresLayer: Fire point clicked!", clickedEntity.properties);
            
            // Find all nearby points within radius
            const clickedPoint = { 
              lat: clickedEntity.properties.lat, 
              lon: clickedEntity.properties.lon 
            };
            const nearbyPoints = findNearbyPoints(clickedPoint, pointsWithData, 0.5);
            
            if (nearbyPoints.length > 0) {
              const centerLat = nearbyPoints.reduce((sum, pt) => sum + pt.lat, 0) / nearbyPoints.length;
              const centerLon = nearbyPoints.reduce((sum, pt) => sum + pt.lon, 0) / nearbyPoints.length;
              
              // Get screen position from mouse event
              const globeCanvas = globus.renderer.handler.canvas;
              const rect = globeCanvas.getBoundingClientRect();
              
              onClusterClick({
                points: nearbyPoints,
                centerLat,
                centerLon,
                dateRange: `${startISO.split(' ')[0]} to ${endISO.split(' ')[0]}`,
                avgConfidence: nearbyPoints.reduce((sum, pt) => sum + (pt.confidence || 0), 0) / nearbyPoints.length
              }, {
                x: e.clientX || (rect.left + rect.width / 2),
                y: e.clientY || (rect.top + rect.height / 2)
              });
            }
          };
          
          globus.planet.renderer.events.on("lclick", clickHandler);
          console.log("FiresLayer: Globe click handler attached");
          
          // Store handler reference for cleanup
          layer._fireClickHandler = clickHandler;
        }
      } catch(e) { console.error("Fires data load failed:", e); }
    })();

    return () => {
      cancelled = true;
      cam.events.off("moveend", sync);
      
      // Clean up globe click handler
      const layer = globus.planet.getLayerByName("Fires");
      if (layer && layer._fireClickHandler) {
        globus.planet.renderer.events.off("lclick", layer._fireClickHandler);
        delete layer._fireClickHandler;
      }
      // Remove the layer entirely from the globe so toggling hides it
      try {
        const l = globus.planet.getLayerByName("Fires");
        if (l) {
          // Remove all entities to avoid leaks
          if (l.entities && Array.isArray(l.entities)) {
            l.entities.slice().forEach(e => l.remove(e));
          }
          globus.planet.removeLayer(l);
          console.log("FiresLayer: removed 'Fires' layer");
        }
      } catch (e) {
        console.warn("FiresLayer: error removing layer", e);
      }
    };
  }, [globus, startDate, endDate, onClusterClick]);

  return null;
}
