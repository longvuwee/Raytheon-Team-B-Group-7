import React, { useEffect, useRef, useState } from "react";
import { Globe, OpenStreetMap, GlobusRgbTerrain } from "@openglobus/og";

export default function App() {
  const globeRef = useRef(null);
  const [globus, setGlobus] = useState(null);
  const [currentLayer, setCurrentLayer] = useState("OSM");

  useEffect(() => {
    if (!globeRef.current) return;

    const osm = new OpenStreetMap();
    const terrain = new GlobusRgbTerrain();

    const globeInstance = new Globe({
      target: globeRef.current,
      name: "Earth",
      layers: [osm],
      resourcesSrc: "/og-res",
      fontsSrc: "/og-res/fonts",
    });

    setGlobus(globeInstance);

    // Handle resize
    const handleResize = () => globeInstance.renderer.resize();
    window.addEventListener("resize", handleResize);

    // Camera start
    globeInstance.planet.camera.flyLonLat({
      lon: -98.583,
      lat: 39.833,
      height: 4500000,
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      globeInstance.destroy();
    };
  }, []);

  const switchLayer = (layerName) => {
    if (!globus) return;
    globus.layers.clear();
    if (layerName === "OSM") {
      globus.layers.add(new OpenStreetMap());
    }
    setCurrentLayer(layerName);
  };

  const zoomIn = () => {
    if (!globus) return;
    globus.planet.camera.zoomIn();
  };

  const zoomOut = () => {
    if (!globus) return;
    globus.planet.camera.zoomOut();
  };

  const resetCompass = () => {
    if (!globus) return;
    globus.planet.camera.flyLonLat({ lon: 0, lat: 0, height: 4500000 });
  };

  return (
    <div ref={globeRef} style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
        <button onClick={() => switchLayer("OSM")} disabled={currentLayer === "OSM"}>OSM</button>
        <button onClick={() => switchLayer("SAT")} disabled={currentLayer === "SAT"}>SAT</button>
      </div>
      <div style={{ position: "absolute", top: 50, right: 10, zIndex: 10, display: "flex", flexDirection: "column" }}>
        <button onClick={zoomIn} style={{ marginBottom: 5 }}>+</button>
        <button onClick={zoomOut} style={{ marginBottom: 5 }}>-</button>
        <button onClick={resetCompass}>🧭</button>
      </div>
    </div>
  );
}
