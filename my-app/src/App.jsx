// src/App.jsx
import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";

import "./index.css";
import "./App.css";

/* ---- Components ---- */
import GlobeCanvas from "./components/GlobeCanvas";
import FiresLayer from "./components/FiresLayer";
import Timeline from "./components/Timeline";
import IntroOverlay from "./components/IntroOverlay";
import LeftInfoPanel from "./components/LeftInfoPanel";
import LayerPanel from "./components/RightInfoPanel";
import Logo from "./components/Logo";
import Header from "./components/Header";
import HeatmapOverlayLayer from "./components/HeatmapOverlayLayer";
import Creators from "./components/Creators";
import SearchBar from "./components/SearchBar";
import ClusterPopup from "./components/ClusterPopup";
import ForecastControls from "./components/ForecastControls";
import FireSpreadLayer from "./components/FireSpreadLayer";
import FireInputsProcessor from "./components/FireInputsProcessor";

/* ---- Hooks ---- */
import useTimeline from "./hooks/useTimeline";

/* ---- Utils ---- */
import { generateSpreadForecast } from "./utils/forecastApi";
import makeForecastHeatmap from "./utils/makeForecastHeatmap";
import makeForecastPixelGrid, {
  snapToGrid,
  blockCenter,
} from "./utils/makeForecastPixelGrid";

// Shared backend base URL
const BACKEND_URL =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  "https://firecast-x.onrender.com";

function App() {
  // Imperative handle to the globe component
  const globeRef = useRef(null);

  // Track when globe is ready
  const [globeReady, setGlobeReady] = useState(false);

  // Navigation state
  const [currentView, setCurrentView] = useState("map");

  // Base-map toggle
  const [base, setBase] = useState("OSM");

  // Date range state
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  });

  // Visualization mode + layer visibility for the left panel
  const [vizMode, setVizMode] = useState("KDE Heatmap");
  const [layers, setLayers] = useState({
    "Predicted Spread": true,
    "2025 Fire Perimeters": true,
    "MODIS Hotspots": true,
  });

  // Forecast state
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [popupPosition, setPopupPosition] = useState(null);
  const [forecastPredictions, setForecastPredictions] = useState(null);
  const [forecastFrame, setForecastFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const prevLayersRef = useRef(null);

  // Keep this stable so GlobeCanvas doesn't re-init
  const initialView = useMemo(
    () => ({ lon: -120.583, lat: 35.263, height: 2000000 }),
    []
  );

  // Intro overlay
  const [showIntro, setShowIntro] = useState(true);

  // Handle hash-based navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove the '#'

      if (hash === "/creators") {
        setCurrentView("creators");
      } else if (hash === "/api") {
        setCurrentView("api");
      } else if (hash === "/sources") {
        setCurrentView("sources");
      } else if (hash === "/docs") {
        setCurrentView("docs");
      } else {
        setCurrentView("map");
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    // Initial load
    handleHashChange();

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Check when globe is ready
  useEffect(() => {
    const checkGlobe = setInterval(() => {
      if (globeRef.current && typeof globeRef.current.getGlobus === "function") {
        setGlobeReady(true);
        clearInterval(checkGlobe);
      }
    }, 100);

    return () => clearInterval(checkGlobe);
  }, []);

  // Timeline state (Dallas time) - connected to date range
  const {
    tz,
    now,
    end,
    sliderIdx,
    setSliderIdx,
    selectedDate,
    maxHours,
  } = useTimeline("America/Chicago", startDate, endDate);

  const handleBaseChange = (name) => {
    if (name === base) return;
    setBase(name);
    if (globeRef.current && typeof globeRef.current.setBase === "function") {
      globeRef.current.setBase(name);
    }
  };

  // Handle cluster click
  const handleClusterClick = (cluster, position) => {
    setSelectedCluster(cluster);
    setPopupPosition(position);
    setIsPlaying(false);
  };

  // Handle run forecast
  const handleRunForecast = async (cluster, forecastHours) => {
    try {
      console.log("Running forecast for cluster:", cluster);

      // Close popup
      setSelectedCluster(null);
      setPopupPosition(null);

      // Generate predictions from backend (neural network model)
      const resp = await generateSpreadForecast(
        cluster.points,
        forecastHours,
        "neural_network"
      );

      let predictions = resp.predictions || [];

      // Inject a contiguous N×N rasterized "seed" around the click location
      try {
        const clicked = cluster.clickedPoint || cluster.points[0];
        const lat0 = clicked && (clicked.latitude ?? clicked.lat);
        const lon0 = clicked && (clicked.longitude ?? clicked.lon);

        if (lat0 && lon0) {
          const center = snapToGrid(lat0, lon0);
          const gridSize = 7; // odd -> centered
          const half = Math.floor(gridSize / 2);
          const seedPoints = [];

          for (let dr = -half; dr <= half; dr++) {
            for (let dc = -half; dc <= half; dc++) {
              const r = center.row + dr;
              const c = center.col + dc;
              const bc = blockCenter(r, c);
              seedPoints.push({
                time: 0,
                lat: bc.centerLat,
                lon: bc.centerLon,
                spread_probability: 1.0,
              });
            }
          }

          predictions = predictions.concat(seedPoints);
        }
      } catch (e) {
        console.warn("Failed to create raster seed:", e);
      }

      const timeSteps = resp.time_steps || forecastHours || 1;

      // Group predictions by hour
      const predictionsByHour = {};
      predictions.forEach((pred) => {
        const hour =
          pred.time !== undefined && pred.time !== null ? pred.time : 0;
        if (!predictionsByHour[hour]) predictionsByHour[hour] = [];
        predictionsByHour[hour].push(pred);
      });

      // Compute overall bbox from cluster points for empty-frame fallback
      const lats = cluster.points.map((p) => p.latitude || p.lat || 0);
      const lons = cluster.points.map((p) => p.longitude || p.lon || 0);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const latPadding = (maxLat - minLat) * 0.1 || 0.01;
      const lonPadding = (maxLon - minLon) * 0.1 || 0.01;
      const overallBbox = [
        minLon - lonPadding,
        minLat - latPadding,
        maxLon + lonPadding,
        maxLat + latPadding,
      ];

      // Helper: transparent PNG for truly empty frames
      const makeEmptyImage = (width = 800, height = 600) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, width, height);
        return canvas.toDataURL("image/png");
      };

      // Build forecastData frames for 0..timeSteps-1
      const forecastData = [];
      for (let h = 0; h < timeSteps; h++) {
        const preds = predictionsByHour[h] || [];
        let imageDataUrl = null;
        let bbox = null;

        // Hour 0: try discrete pixel-grid first
        if (h === 0) {
          try {
            const pixel = makeForecastPixelGrid(preds);
            if (pixel && pixel.imageDataUrl) {
              imageDataUrl = pixel.imageDataUrl;
              bbox = pixel.bbox;
            }
          } catch (e) {
            console.warn("makeForecastPixelGrid failed:", e);
          }
        }

        // Fallback to heatmap renderer
        if (!imageDataUrl) {
          const out = makeForecastHeatmap(preds);
          if (out && out.imageDataUrl) {
            imageDataUrl = out.imageDataUrl;
            bbox = out.bbox;
          }
        }

        // Ultimately fallback to transparent image + overall bbox
        if (!imageDataUrl) {
          imageDataUrl = makeEmptyImage();
          bbox = overallBbox;
        }

        forecastData.push({
          hour: h,
          imageDataUrl,
          bbox,
          predictions: preds,
        });
      }

      // Hide other prediction layers while showing forecast
      prevLayersRef.current = layers;
      setLayers((prev) => ({
        ...prev,
        "Predicted Spread": false,
        "MODIS Hotspots": false,
      }));

      setForecastPredictions(forecastData);
      setForecastFrame(0);
      // Start paused so user can inspect frame 0
      setIsPlaying(false);
    } catch (error) {
      console.error("Forecast generation failed:", error);
      window.alert("Failed to generate forecast. Please try again.");
    }
  };

  // Animation playback control
  useEffect(() => {
    if (!isPlaying || !forecastPredictions || forecastPredictions.length === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      setForecastFrame((frame) => {
        const nextFrame = frame + 1;
        if (nextFrame >= forecastPredictions.length) {
          // End of animation - stop and restore layers
          handleForecastStop();
          return frame; // stay at last valid frame
        }
        return nextFrame;
      });
    }, 1000 / playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, forecastPredictions, playbackSpeed]);

  const handleForecastPlayPause = () => {
    if (!forecastPredictions || forecastPredictions.length === 0) return;

    if (forecastFrame >= forecastPredictions.length - 1) {
      // Restart from beginning
      setForecastFrame(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((prev) => !prev);
    }
  };

  const handleForecastSeek = (frame) => {
    setForecastFrame(frame);
    setIsPlaying(false);
  };

  const handleForecastStop = () => {
    setIsPlaying(false);
    setForecastPredictions(null);
    setForecastFrame(0);

    if (prevLayersRef.current) {
      setLayers(prevLayersRef.current);
      prevLayersRef.current = null;
    }
  };

  // --- Backend connectivity test helper (use /health) ---
  const testBackend = async () => {
    const url = `${BACKEND_URL.replace(/\/+$/, '')}/health`;
    try {
      console.log("[ui] Testing backend:", url);
      const res = await fetch(url, { method: "GET" });
      const text = await res.text();
      console.log("[ui] Backend status:", res.status);
      console.log("[ui] Backend body:", text);
      if (!res.ok) {
        alert(`Backend error ${res.status}: ${text}`);
        return;
      }
      try {
        const json = JSON.parse(text);
        alert("Backend OK: " + JSON.stringify(json));
      } catch {
        alert("Backend OK: " + text);
      }
    } catch (err) {
      console.error("[ui] Error talking to backend:", err);
      alert(`Network / CORS error: ${err?.message || err}`);
    }
  };

  const renderContent = () => {
    switch (currentView) {
      case "creators":
        return <Creators />;

      case "api":
        return (
          <div className="page-content">
            <h1>API Documentation</h1>
            <p>API documentation coming soon...</p>
          </div>
        );

      case "sources":
        return (
          <div className="page-content">
            <h1>Data Sources</h1>
            <p>Data sources information coming soon...</p>
          </div>
        );

      case "docs":
        return (
          <div className="page-content">
            <h1>Documentation</h1>
            <p>Documentation coming soon...</p>
          </div>
        );

      default:
        return (
          <>
            {/* === Globe === */}
            <GlobeCanvas
              ref={globeRef}
              className="globe"
              initialView={initialView}
            />

            {/* Data layers only when globe is ready */}
            {globeReady && (
              <>
                {layers["Predicted Spread"] && (
                  <HeatmapOverlayLayer
                    globeRef={globeRef}
                    startDate={selectedDate}
                    endDate={endDate}
                  />
                )}

                {layers["MODIS Hotspots"] && (
                  <FiresLayer
                    globus={
                      globeRef.current &&
                      typeof globeRef.current.getGlobus === "function"
                        ? globeRef.current.getGlobus()
                        : null
                    }
                    startDate={selectedDate}
                    endDate={endDate}
                    onClusterClick={handleClusterClick}
                  />
                )}

                {forecastPredictions && (
                  <FireSpreadLayer
                    globeRef={globeRef}
                    predictions={forecastPredictions}
                    currentFrame={forecastFrame}
                  />
                )}
              </>
            )}

            {/* Cluster Popup */}
            {selectedCluster && popupPosition && (
              <ClusterPopup
                cluster={selectedCluster}
                position={popupPosition}
                onClose={() => {
                  setSelectedCluster(null);
                  setPopupPosition(null);
                }}
                onRunForecast={handleRunForecast}
              />
            )}

            {/* Forecast Controls */}
            {forecastPredictions && forecastPredictions.length > 0 && (
              <ForecastControls
                isPlaying={isPlaying}
                currentHour={
                  forecastPredictions[forecastFrame]
                    ? forecastPredictions[forecastFrame].hour
                    : 0
                }
                totalHours={
                  forecastPredictions[forecastPredictions.length - 1]
                    ? forecastPredictions[forecastPredictions.length - 1].hour
                    : 0
                }
                onPlayPause={handleForecastPlayPause}
                onSeek={handleForecastSeek}
                onStop={handleForecastStop}
                onSpeedChange={setPlaybackSpeed}
                speed={playbackSpeed}
              />
            )}

            {/* === Overlay UI === */}
            <div className="ui-overlay">
              <LeftInfoPanel
                baseMap={base}
                onBaseMapChange={handleBaseChange}
                vizMode={vizMode}
                setVizMode={setVizMode}
                layers={layers}
                setLayers={setLayers}
                startDate={startDate}
                endDate={endDate}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
              />

              <LayerPanel />

              <Timeline
                tz={tz}
                now={now}
                end={end}
                sliderIdx={sliderIdx}
                setSliderIdx={setSliderIdx}
                selectedDate={selectedDate}
                maxHours={maxHours}
              />
            </div>

            {/* Intro overlay */}
            <IntroOverlay
              show={showIntro}
              onClose={() => setShowIntro(false)}
              Logo={<Logo className="intro-logo" />}
            />
          </>
        );
    }
  };

  return (
    <div className="app-root">
      <Header
        currentView={currentView}
        globeRef={globeRef}
        SearchBar={SearchBar}
        onLocationSelect={(location) => {
          console.log("Location selected:", location);
        }}
      />

      {/* Backend connectivity test button */}
      <div
        style={{
          position: "fixed",
          top: "80px",
          right: "20px",
          zIndex: 9999,
        }}
      >
        <button onClick={testBackend}>Test backend</button>
      </div>

      {/* Batch fire_inputs processor */}
      <FireInputsProcessor />

      {renderContent()}
    </div>
  );
}

export default App;
