import React, { useEffect, useMemo, useRef, useState } from "react";
import { Globe, OpenStreetMap, XYZ } from "@openglobus/og";
import FireCastLogo from "./assets/FireCast_LOGO.png"; // Import logo image
import "./index.css";
import "./App.css";

export default function App() {
  // ======= INTRO OVERLAY =======
  const [showIntro, setShowIntro] = useState(true);

  // ======= TIMELINE (Dallas time) =======
  const TZ = "America/Chicago";
  const HOUR_MS = 3600_000;

  const now = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }, []);
  const end = useMemo(() => new Date(now.getTime() + 24 * HOUR_MS), [now]);
  const [sliderIdx, setSliderIdx] = useState(0);
  const selectedDate = useMemo(
    () => new Date(now.getTime() + sliderIdx * HOUR_MS),
    [now, sliderIdx]
  );

  const fmtDateTime = (d) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);

  const fmtTZShort = (d) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value || "CT";

  // ======= GLOBE (imperative) =======
  const globeRef = useRef(null);
  const [globus, setGlobus] = useState(null);
  const [base, setBase] = useState("OSM");

  const US_VIEW = { lon: -98.583, lat: 39.833, height: 4_500_000 };

  useEffect(() => {
    if (!globeRef.current) return;

    // Base layers
    const osm = new OpenStreetMap();
    const sat = new XYZ("ESRI World Imagery", {
      isBaseLayer: true,
      url:
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });

    // Create globe
    const globeInstance = new Globe({
      target: globeRef.current,
      name: "Earth",
      layers: [osm], // start with OSM
      resourcesSrc: "/og-res",
      fontsSrc: "/og-res/fonts",
    });

    setGlobus(globeInstance);

    // Initial camera above U.S.
    globeInstance.planet.camera.flyLonLat(US_VIEW);

    // Handle resize
    const handleResize = () => globeInstance.renderer.resize();
    window.addEventListener("resize", handleResize);

    // Keep canvas flush with viewport
    const onResizeVH = () =>
      document.documentElement.style.setProperty("--vh", `${window.innerHeight}px`);
    onResizeVH();
    window.addEventListener("resize", onResizeVH);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("resize", onResizeVH);
      globeInstance.destroy();
    };
  }, []);

  // Switch base layer
  const switchLayer = (layerName) => {
    if (!globus) return;
    globus.layers.clear();
    if (layerName === "OSM") {
      globus.layers.add(new OpenStreetMap());
    } else if (layerName === "SAT") {
      globus.layers.add(
        new XYZ("ESRI World Imagery", {
          isBaseLayer: true,
          url:
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        })
      );
    }
    setBase(layerName);
  };

  // Camera controls
  const zoomIn = () => globus?.planet?.camera?.zoomIn();
  const zoomOut = () => globus?.planet?.camera?.zoomOut();
  const resetCompass = () => globus?.planet?.camera?.flyLonLat(US_VIEW);

  return (
    <div className="app-root">
      {/* ==== Globe canvas ==== */}
      <div ref={globeRef} className="globe" />

      {/* ==== UI OVERLAY ==== */}
      <div className="ui-overlay">
        {/* Logo */}
        <img src={FireCastLogo} alt="FireCast" className="app-logo" draggable="false" />

        {/* LEFT — Panel */}
        <div className="panel panel-left">
          <h3 className="panel-title">Wildfire Prediction Panel</h3>
          <p className="panel-text">
            <strong>(MVP)</strong> Controls for hotspots, perimeters, and forecasts.
          </p>
          <p className="panel-text subtle">Use the timeline to explore hourly forecasts (Dallas time).</p>
        </div>

        {/* RIGHT — Layers (sample toggles) */}
        <div className="panel panel-right">
          <h4 className="panel-subtitle">Layers</h4>
          <div className="layer-list">
            {["Predicted Spread", "Fire Perimeters", "MODIS Hotspots", "Wind Direction"].map(
              (label, i) => (
                <label key={i} className="layer-item">
                  <input type="checkbox" defaultChecked={i % 2 === 0} className="layer-checkbox" />
                  {label}
                </label>
              )
            )}
          </div>
        </div>

        {/* TOP-LEFT — Base layer switch */}
        <div className="base-switch">
          <button
            onClick={() => switchLayer("OSM")}
            disabled={base === "OSM"}
            className={`btn ${base === "OSM" ? "btn-disabled" : ""}`}
          >
            OSM
          </button>
          <button
            onClick={() => switchLayer("SAT")}
            disabled={base === "SAT"}
            className={`btn ${base === "SAT" ? "btn-disabled" : ""}`}
          >
            SAT
          </button>
        </div>

        {/* TOP-RIGHT — Zoom & Compass */}
        <div className="controls-right">
          <button onClick={zoomIn} className="btn icon">+</button>
          <button onClick={zoomOut} className="btn icon">-</button>
          <button onClick={resetCompass} className="btn icon" title="Reset view">🧭</button>
        </div>

        {/* BOTTOM — Timeline */}
        <div className="timeline">
          <span className="timeline-label">{fmtDateTime(now)}</span>
          <input
            type="range"
            min={0}
            max={24}
            step={1}
            value={sliderIdx}
            onChange={(e) => setSliderIdx(Number(e.target.value))}
            className="timeline-range"
            aria-label="Forecast time (hourly, Dallas time)"
          />
          <span className="timeline-label">{fmtDateTime(end)}</span>

          <div className="timeline-current" title={selectedDate.toISOString()}>
            {fmtDateTime(selectedDate)} {fmtTZShort(selectedDate)}
          </div>
        </div>
      </div>

      {/* INTRO OVERLAY */}
      {showIntro && (
        <div className="intro" onClick={() => setShowIntro(false)}>
          <div className="intro-card" onClick={(e) => e.stopPropagation()}>
            <img src={FireCastLogo} alt="FireCast" className="intro-logo" draggable="false" />
            <h1 className="intro-title">Fire CastX</h1>
            <p className="intro-subtitle">Fires around the U.S in one place.</p>
            <div className="intro-cta">Click anywhere to continue</div>
          </div>
        </div>
      )}
    </div>
  );
}
