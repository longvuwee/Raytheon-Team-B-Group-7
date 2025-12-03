// GlobeCanvas.jsx
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as og from "@openglobus/og";

const GlobeCanvas = forwardRef(function GlobeCanvas(
  { className, initialView = { lon: -120.583, lat: 35.263, height: 2000000 } },
  ref
) {
  const hostRef = useRef(null);
  const globeRef = useRef(null);
  const osmRef = useRef(null);
  const satRef = useRef(null);
  const didInit = useRef(false); // Guard against StrictMode double-mounts

  useEffect(() => {
    if (didInit.current) return; // prevent duplicate init (StrictMode)
    didInit.current = true;

    const osm = new og.OpenStreetMap();
    const sat = new og.Bing();

    const g = new og.Globe({
      target: hostRef.current,
      name: "Earth",
      layers: [osm, sat],
      terrain: new og.GlobusRgbTerrain(),
      resourcesSrc: "/og-res",
      fontsSrc: "/og-res/fonts",
    });

    osmRef.current = osm;
    satRef.current = sat;
    sat.setVisibility(false);

    // placeholder data layer – real fire layers are added elsewhere
    g.planet.addLayer(new og.Vector("Fires"));

    // === Weather overlays (OpenWeather tile API) ===
    const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY;
    console.log("OpenWeather API key from env:", apiKey);

    if (apiKey) {
      // Clouds – main visible overlay
      const cloudsLayer = new og.layer.XYZ("Clouds", {
        isBaseLayer: false,
        url: `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${apiKey}`,
        visibility: true,          // on by default
        opacity: 1,              // mostly opaque but map still peeks through
        attribution: "Weather © OpenWeatherMap",
      });

      // Optional: precipitation, temperature, wind (start hidden)
      const precipLayer = new og.layer.XYZ("Precipitation", {
        isBaseLayer: false,
        url: `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${apiKey}`,
        visibility: false,
        opacity: 2,
        attribution: "Weather © OpenWeatherMap",
      });

      const tempLayer = new og.layer.XYZ("Temperature", {
        isBaseLayer: false,
        url: `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${apiKey}`,
        visibility: false,
        opacity: 2,
        attribution: "Weather © OpenWeatherMap",
      });

      const windLayer = new og.layer.XYZ("WindSpeed", {
        isBaseLayer: false,
        url: `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${apiKey}`,
        visibility: false,
        opacity: 2,
        attribution: "Weather © OpenWeatherMap",
      });

      g.planet.addLayer(cloudsLayer);
      g.planet.addLayer(precipLayer);
      g.planet.addLayer(tempLayer);
      g.planet.addLayer(windLayer);

      // Expose for quick control from other components (e.g., left panel)
      window.ogWeatherLayers = {
        clouds: cloudsLayer,
        precip: precipLayer,
        temp: tempLayer,
        wind: windLayer,
      };
    } else {
      console.warn(
        "VITE_OPENWEATHER_API_KEY is missing – weather tile layers will not load."
      );
    }

    g.planet.camera.flyLonLat(initialView);
    globeRef.current = g;

    const onResize = () => g.renderer.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try {
        g.destroy();
      } catch {
        // Ignore errors during globe cleanup
      }
      globeRef.current = null;
      osmRef.current = null;
      satRef.current = null;
      didInit.current = false;
      window.ogWeatherLayers = undefined;
    };
  }, [initialView]);

  // Expose a tiny API to the parent via ref
  useImperativeHandle(
    ref,
    () => ({
      getGlobus: () => globeRef.current,
      setBase: (name) => {
        if (!osmRef.current || !satRef.current) return;
        const showOSM = name === "OSM";
        osmRef.current.setVisibility(showOSM);
        satRef.current.setVisibility(!showOSM);
      },
    }),
    []
  );

  return <div ref={hostRef} className={className} />;
});

export default GlobeCanvas;
