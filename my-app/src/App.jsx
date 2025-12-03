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
// FireInputsProcessor removed

/* ---- Hooks ---- */
import useTimeline from "./hooks/useTimeline";

/* ---- Utils ---- */
import { streamSpreadForecast } from "./utils/forecastApi";
import { fetchRecentFireInputs, fetchNearestFireInput } from "./api/fireInputsApi";
// removed unused selectAndPredictNeighborhood
import makeForecastHeatmap from "./utils/makeForecastHeatmap";
import makeForecastPixelGrid, { snapToGrid } from "./utils/makeForecastPixelGrid";
import makeInitialStateRaster from "./utils/makeInitialStateRaster";
import { GeoImage } from "@openglobus/og";

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
  const [statusMessage, setStatusMessage] = useState(null);
  const initialStateLayerRef = useRef(null);
  const forecastStreamRef = useRef(null);
  const burnedCellsRef = useRef(new Set());

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
      // Close popup
      setSelectedCluster(null);
      setPopupPosition(null);

      // --- Initial state raster from cluster points ---
      let initRaster = null;
      try {
        // Remove any previous initial-state overlay
        const globus = globeRef.current && globeRef.current.getGlobus && globeRef.current.getGlobus();
        if (initialStateLayerRef.current && globus?.planet) {
          try { globus.planet.removeLayer(initialStateLayerRef.current); } catch (e) { void e; }
          initialStateLayerRef.current = null;
        }
        const raster = makeInitialStateRaster(cluster.points || []);
        initRaster = raster;
        if (raster?.imageDataUrl && raster?.bbox && globus?.planet) {
          const [minLon, minLat, maxLon, maxLat] = raster.bbox;
          const layer = new GeoImage("Initial Fire State", {
            src: raster.imageDataUrl,
            corners: [
              [minLon, minLat],
              [maxLon, minLat],
              [maxLon, maxLat],
              [minLon, maxLat],
            ],
            visibility: true,
            isBaseLayer: false,
            opacity: 0.7,
          });
          globus.planet.addLayer(layer);
          initialStateLayerRef.current = layer;
          console.log("App: Initial Fire State raster added on forecast run; cells=", raster?.cells?.length || 0);
        }
      } catch (e) {
        console.warn("App: initial state raster generation failed", e);
      }

      // --- Streamed simulation via backend (SSE) ---
      const clicked = cluster.clickedPoint || cluster.points[0];
      if (!clicked) {
        alert("No clicked point available for forecast");
        return;
      }
      const lat0 = Number(clicked.latitude ?? clicked.lat);
      const lon0 = Number(clicked.longitude ?? clicked.lon);
      if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) {
        alert("Clicked point is missing latitude/longitude");
        return;
      }

      // Look up the nearest fire_inputs row to use as the seed (ensures features come from the table)
      const seedRow = await fetchNearestFireInput(lat0, lon0);
      const seedPoint = seedRow
        ? {
            latitude: seedRow.latitude,
            longitude: seedRow.longitude,
            brightness: seedRow.brightness,
            bright_t31: seedRow.bright_t31,
            confidence: seedRow.confidence,
            daynight: seedRow.daynight,
            elevation: seedRow.elevation,
            slope: seedRow.slope,
            aspect: seedRow.aspect,
            temp: seedRow.temp,
            humidity: seedRow.humidity,
            wind_speed: seedRow.wind_speed,
            precip: seedRow.precip,
            month: seedRow.month,
          }
        : { latitude: lat0, longitude: lon0 };

      // Build seed set from initial raster cells (preferred); fallback to cluster points
      const seeds = (() => {
        const templ = seedPoint;
        const fromRaster = Array.isArray(initRaster?.cells) ? initRaster.cells : [];
        const CAP = 2000; // backend has MAX_CELLS=5000; keep healthy margin
        if (fromRaster.length) {
          const out = [];
          for (let i = 0; i < fromRaster.length && out.length < CAP; i++) {
            const c = fromRaster[i];
            out.push({
              latitude: c.centerLat,
              longitude: c.centerLon,
              brightness: templ.brightness,
              bright_t31: templ.bright_t31,
              confidence:  templ.confidence ?? 100,
              daynight:    templ.daynight ?? 1,
              elevation:   templ.elevation,
              slope:       templ.slope,
              aspect:      templ.aspect,
              temp:        templ.temp,
              humidity:    templ.humidity,
              wind_speed:  templ.wind_speed,
              precip:      templ.precip,
              month:       templ.month,
            });
          }
          return out.length ? out : [templ];
        }
        // Fallback to cluster points de-duped by grid cell
        const pts = Array.isArray(cluster.points) ? cluster.points : [];
        const seen = new Set();
        const out = [];
        for (const p of pts) {
          const plat = Number(p.latitude ?? p.lat);
          const plon = Number(p.longitude ?? p.lon);
          if (!Number.isFinite(plat) || !Number.isFinite(plon)) continue;
          const cell = snapToGrid(plat, plon);
          const key = `${cell.row},${cell.col}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            latitude: plat,
            longitude: plon,
            brightness: templ.brightness,
            bright_t31: templ.bright_t31,
            confidence:  templ.confidence ?? 100,
            daynight:    templ.daynight ?? 1,
            elevation:   templ.elevation,
            slope:       templ.slope,
            aspect:      templ.aspect,
            temp:        templ.temp,
            humidity:    templ.humidity,
            wind_speed:  templ.wind_speed,
            precip:      templ.precip,
            month:       templ.month,
          });
          if (out.length >= 200) break;
        }
        return out.length ? out : [templ];
      })();
      console.log("[forecast] seeding cells (from raster?):", Array.isArray(initRaster?.cells) && initRaster.cells.length ? 'yes' : 'no', 'count=', seeds.length, seeds.slice(0, 5));

      // Compute overall bbox from clicked point for empty-frame fallback
      const latPad = 0.01;
      const lonPad = 0.01;
      const seedLat = Number(seedPoint.latitude ?? lat0 ?? 0);
      const seedLon = Number(seedPoint.longitude ?? lon0 ?? 0);
      const overallBbox = [seedLon - lonPad, seedLat - latPad, seedLon + lonPad, seedLat + latPad];

      // Helper: transparent PNG for empty frames
      const makeEmptyImage = (width = 800, height = 600) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, width, height);
        return canvas.toDataURL("image/png");
      };

      // Hide other prediction layers while showing forecast
      prevLayersRef.current = layers;
      setLayers((prev) => ({
        ...prev,
        "Predicted Spread": false,
        "MODIS Hotspots": false,
      }));

      // Start with empty frames and stream-increment
      setForecastPredictions([]);
      setForecastFrame(0);
      setIsPlaying(false); // we will advance frame to latest on each step to preview progression

      // Close any previous stream
      if (forecastStreamRef.current) {
        try { forecastStreamRef.current.close(); } catch (e) { void e; }
        forecastStreamRef.current = null;
      }
      burnedCellsRef.current = new Set();

      const framesRef = { current: [] };
      forecastStreamRef.current = streamSpreadForecast({
        clusterPoints: seeds,
        forecastHours,
        modelName: "logreg",
        spreadThreshold: 0.6,
        fastMode: true,
        maxCandidatesPerStep: 200,
        maxCells: 3000,
        onLog: (msg) => {
          if (msg && (msg.step_ms !== undefined || msg.eta_ms !== undefined)) {
            const s = msg;
            console.log(`[SSE] step ${s.step ?? '?'}: ${s.step_ms ?? '?'} ms | avg ${s.avg_ms ?? '?'} ms | ETA ${(s.eta_ms/1000).toFixed(1)}s for ${s.remaining_steps ?? '?'} steps`);
          } else {
            console.log("[SSE:log]", msg);
          }
        },
        onStep: (payload) => {
          const h = Number(payload?.time ?? 0);
          const preds = Array.isArray(payload?.predictions) ? payload.predictions : [];
          // Track burned cells for greyscale fill
          for (const p of preds) {
            if (Number(p?.t_burn) >= 2) {
              const cell = snapToGrid(Number(p.lat), Number(p.lon));
              burnedCellsRef.current.add(`${cell.row},${cell.col}`);
            }
          }
          let imageDataUrl = null;
          let bbox = null;
          try {
            const pixel = makeForecastPixelGrid(preds, { burnedCells: burnedCellsRef.current });
            if (pixel && pixel.imageDataUrl) {
              imageDataUrl = pixel.imageDataUrl;
              bbox = pixel.bbox;
            }
          } catch (e) {
            console.warn("makeForecastPixelGrid failed:", e);
          }
          if (!imageDataUrl) {
            const out = makeForecastHeatmap(preds); // fallback (no burned overlay)
            if (out?.imageDataUrl) {
              imageDataUrl = out.imageDataUrl;
              bbox = out.bbox;
            }
          }
          if (!imageDataUrl) {
            imageDataUrl = makeEmptyImage();
            bbox = overallBbox;
          }
          // Append or replace frame at hour h
          const next = framesRef.current.slice();
          next[h] = { hour: h, imageDataUrl, bbox, predictions: preds };
          // Compact to remove holes in case of out-of-order events
          const compact = next.filter(Boolean);
          framesRef.current = compact;
          setForecastPredictions(compact);
          setForecastFrame(compact.length - 1); // preview latest step as it arrives
        },
        onDone: () => {
          console.log("[SSE] done");
          forecastStreamRef.current = null;
        },
        onError: (e) => {
          console.warn("[SSE] error", e);
        },
      });
    } catch (error) {
      console.error("Forecast generation failed:", error);
      window.alert("Failed to generate forecast. Please try again.");
    }
  };

  // Removed unused handleRunPointPredictionNeighbors



  // Animation playback control
  useEffect(() => {
    if (!isPlaying || !forecastPredictions || forecastPredictions.length === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      setForecastFrame((frame) => {
        const nextFrame = frame + 1;
        if (nextFrame >= forecastPredictions.length) {
          // Pause at last frame; keep overlay visible
          setIsPlaying(false);
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

    // Close live stream if active
    if (forecastStreamRef.current) {
      try { forecastStreamRef.current.close(); } catch (e) { void e; }
      forecastStreamRef.current = null;
    }

    if (prevLayersRef.current) {
      setLayers(prevLayersRef.current);
      prevLayersRef.current = null;
    }

    // Remove initial-state overlay, if any
    const globus = globeRef.current && globeRef.current.getGlobus && globeRef.current.getGlobus();
    if (initialStateLayerRef.current && globus?.planet) {
      try { globus.planet.removeLayer(initialStateLayerRef.current); } catch (e) { void e; }
      initialStateLayerRef.current = null;
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

      {/* Batch fire_inputs processor removed per request */}

      {statusMessage && (
        <div
          style={{
            position: "fixed",
            top: "12px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 6,
            zIndex: 9999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}
        >
          {statusMessage}
        </div>
      )}

      {renderContent()}
    </div>
  );
}

export default App;
