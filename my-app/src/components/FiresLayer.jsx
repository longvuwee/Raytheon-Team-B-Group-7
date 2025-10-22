import { useEffect } from "react";
import { Entity } from "@openglobus/og";
import makeSquareIcon from "../utils/dataPoints";

export default function FiresLayer({ globus }) {
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
      if (Math.abs(px - last) < 0.5) return;
      last = px; entities.forEach(e => e.billboard?.setSize(px, px));
    };
    const cam = globus.planet.camera;
    cam.events.on("move", sync); cam.events.on("zoom", sync); cam.events.on("moveend", sync);

    (async () => {
      try {
        const text = await (await fetch("/data/fires_labeled_with_perimeter_labels.csv")).text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        const headers = lines[0].split(",").map(h=>h.trim().toLowerCase());
        const latIdx = headers.indexOf("latitude"), lonIdx = headers.indexOf("longitude");
        for (let i=1;i<lines.length && !cancelled;i++) {
          const row = lines[i].split(",");
          const lat = parseFloat(row[latIdx]), lon = parseFloat(row[lonIdx]);
          if (!isFinite(lat) || !isFinite(lon)) continue;
          const ent = new Entity({ lonlat:[lon,lat], billboard:{ src: iconURL, size:[last,last] }});
          layer.add(ent); entities.push(ent);
          if (i % 2000 === 0) await new Promise(r=>requestAnimationFrame(r));
        }
        sync();
      } catch(e) { console.error("Fires CSV load failed:", e); }
    })();

    return () => {
      cancelled = true;
      cam.events.off("move", sync); cam.events.off("zoom", sync); cam.events.off("moveend", sync);
    };
  }, [globus]);

  return null;
}
