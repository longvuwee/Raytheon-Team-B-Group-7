// GlobeCanvas.jsx
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Globe, GlobusRgbTerrain, OpenStreetMap, Bing, Vector } from "@openglobus/og";

const GlobeCanvas = forwardRef(function GlobeCanvas(
  { className, initialView = { lon:-120.583, lat:35.263, height:2000000 } },
  ref
) {
  const hostRef   = useRef(null);
  const globeRef  = useRef(null);
  const osmRef    = useRef(null);
  const satRef    = useRef(null);
  const didInit   = useRef(false);    // Guard against StrictMode double-mounts

  useEffect(() => {
    if (didInit.current) return;      // prevent duplicate init (StrictMode)
    didInit.current = true;

    const osm = new OpenStreetMap();
    const sat = new Bing();
    const g = new Globe({
      target: hostRef.current,
      name: "Earth",
      layers: [osm, sat],
      terrain: new GlobusRgbTerrain(),
      resourcesSrc: "/og-res",
      fontsSrc: "/og-res/fonts",
    });
    osmRef.current = osm;
    satRef.current = sat;
    sat.setVisibility(false);

    // placeholder data layer – real layers add elsewhere
    g.planet.addLayer(new Vector("Fires"));

    g.planet.camera.flyLonLat(initialView);

    globeRef.current = g;



    const onResize = () => g.renderer.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try { g.destroy(); } catch {
        // Ignore errors during globe cleanup
      }
      globeRef.current = null;
      osmRef.current = null;
      satRef.current = null;
      didInit.current = false;
    };
  }, []); // IMPORTANT: empty deps

  // Expose a tiny API to the parent via ref (no data-* props)
  useImperativeHandle(ref, () => ({
    getGlobus: () => globeRef.current,
    resetToInitialView: () => {
      if (globeRef.current) {
        globeRef.current.planet.camera.flyLonLat(initialView);
      }
    },
    setBase: (name) => {
      if (!osmRef.current || !satRef.current) return;
      const showOSM = name === "OSM";
      osmRef.current.setVisibility(showOSM);
      satRef.current.setVisibility(!showOSM);
    }
  }), []);

  return <div ref={hostRef} className={className} />;
});

export default GlobeCanvas;
