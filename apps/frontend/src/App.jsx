import React, { useMemo } from "react";
import { Globe } from "@openglobus/openglobus-react";
import { OpenStreetMap, GlobusRgbTerrain } from "@openglobus/og";

export default function App() {
  const terrain = useMemo(
    () =>
      new GlobusRgbTerrain(null, {
        url: "/og-res/tiles/{z}/{x}/{y}.png",
        maxNativeZoom: 12,
        plainGridSize: 32,
      }),
    []
  );

  const osmLayer = useMemo(
    () =>
      new OpenStreetMap(null, {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        subdomains: ["a", "b", "c"],
        attribution: "© OpenStreetMap contributors",
        isBaseLayer: true,
      }),
    []
  );

  return (
    <div style={{ height: "100vh" }}>
      <Globe
        name="Earth"
        terrain={terrain}
        layers={[osmLayer]}
        resourcesSrc="/og-res"
        fontsSrc="/og-res/fonts"
        cameraView={{
          lon: -98.583,
          lat: 39.833,
          height: 4500000, // zoomed on U.S.
        }}
      />
    </div>
  );
}
