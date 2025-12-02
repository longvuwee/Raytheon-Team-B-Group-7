// src/App.jsx
import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";

import { LonLat } from "@openglobus/og";

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
import { generateSpreadForecast, runPointPrediction, getPredictionsForTimeStep, runNextTimeStep } from "./utils/forecastApi";
import { fetchRecentFireInputs } from "./api/fireInputsApi";
import { selectAndPredictNeighborhood } from "./api/blockStateApi";
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
  const [statusMessage, setStatusMessage] = useState(null);
  
  // Database-backed simulation state
  const [simulationId, setSimulationId] = useState(null);
  const [maxComputedStep, setMaxComputedStep] = useState(-1);
  const [forecastTemplate, setForecastTemplate] = useState(null);

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
      console.log("Forecast hours:", forecastHours);

      // Close popup
      setSelectedCluster(null);
      setPopupPosition(null);

      // Generate predictions from backend (using random_forest model which is fixed)
      console.log("Calling backend API...");
      const startTime = Date.now();
      const resp = await generateSpreadForecast(
        cluster.points,
        forecastHours,
        "random_forest",  // Use random_forest which has the bug fixes
        true  // compute_initial_only = true for incremental mode
      );
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`Backend response received in ${elapsedTime}s:`, resp);
      let predictions = resp.predictions || [];
      console.log("Number of predictions received:", predictions.length);
      console.log("Initial step only - subsequent steps will be computed on demand");
      
      if (predictions.length === 0) {
        console.error("Backend returned 0 predictions! Check backend logs.");
        alert("Failed to generate forecast. Please try again.");
        setIsLoadingForecast(false);
        return;
      }

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
      console.log("Building forecast frames for", timeSteps, "time steps");
      console.log("Predictions by hour:", Object.keys(predictionsByHour).length, "hours with data");
      
      const forecastData = [];
      for (let h = 0; h < timeSteps; h++) {
        const preds = predictionsByHour[h] || [];
        console.log(`Hour ${h}: ${preds.length} predictions`);
        let imageDataUrl = null;
        let bbox = null;

        // Try discrete pixel-grid for all hours first (clearer than heatmap)
        try {
          const pixel = makeForecastPixelGrid(preds);
          if (pixel && pixel.imageDataUrl) {
            imageDataUrl = pixel.imageDataUrl;
            bbox = pixel.bbox;
          }
        } catch (e) {
          console.warn("makeForecastPixelGrid failed:", e);
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

      console.log("Setting forecast predictions:", forecastData.length, "frames");
      console.log("Sample frame 0:", forecastData[0]);
      
      // Store simulation state - only step 0 computed initially
      setSimulationId(resp.simulation_id);
      setMaxComputedStep(0);  // Only step 0 computed
      setForecastTemplate(cluster.points[0]); // Store first point as template for features
      
      setForecastPredictions(forecastData);
      setForecastFrame(0);
      // Start paused so user can inspect frame 0
      setIsPlaying(false);
      
      // Fly camera to the prediction area
      if (forecastData.length > 0 && forecastData[0].bbox && globeRef.current) {
        const globus = globeRef.current.getGlobus();
        if (globus && globus.planet) {
          const [minLon, minLat, maxLon, maxLat] = forecastData[0].bbox;
          const centerLat = (minLat + maxLat) / 2;
          const centerLon = (minLon + maxLon) / 2;
          const altitude = 500000; // 500km altitude for good view
          
          console.log(`Flying camera to prediction area: lat=${centerLat.toFixed(4)}, lon=${centerLon.toFixed(4)}`);
          
          globus.planet.camera.flyLonLat(
            new LonLat(centerLon, centerLat),
            null,
            null,
            altitude,
            null,
            null,
            2000 // 2 second flight duration
          );
        } else {
          console.warn("Globe or planet not ready for camera flight");
        }
      }
      
      console.log("Forecast setup complete. Predictions should now be visible on globe.");
    } catch (error) {
      console.error("Forecast generation failed:", error);
      window.alert("Failed to generate forecast. Please try again.");
    }
  };

  // Handle neighbor-based prediction requests per your t/t_burn rule
  const handleRunPointPredictionNeighbors = async (cluster) => {
    try {
      const clicked = cluster.clickedPoint || cluster.points[0];
      const lat0 = clicked && (clicked.latitude ?? clicked.lat);
      const lon0 = clicked && (clicked.longitude ?? clicked.lon);
      if (!lat0 || !lon0) {
        alert("Missing clicked point location");
        return;
      }
      const center = snapToGrid(lat0, lon0);

      // Predict for selected neighbors based on fire_cell_state around clicked block
      const { cells, results } = await selectAndPredictNeighborhood(
        { blockRow: center.row, blockCol: center.col, radius: 1, includeDiagonals: false, concurrency: 8 },
        async (cell) => {
          // Minimal row for backend features; environment defaults handled in preparePointInput inside runPointPrediction
          const row = { id: `cell-${cell.row}-${cell.col}`, latitude: cell.centerLat, longitude: cell.centerLon };
          return runPointPrediction(row, "random_forest");
        }
      );

      // Convert results into a single-frame prediction overlay for inspection
      const preds = results
        .filter((r) => r && r.ok && r.res)
        .map((r) => ({
          time: 1,
          lat: r.cell.centerLat,
          lon: r.cell.centerLon,
          spread_probability: Number(r.res.instant_spread_probability ?? 0),
        }));

      const pixel = makeForecastPixelGrid(preds);
      const frame = [{ hour: 1, imageDataUrl: pixel.imageDataUrl, bbox: pixel.bbox, predictions: preds }];
      prevLayersRef.current = layers;
      setLayers((prev) => ({ ...prev, "Predicted Spread": false, "MODIS Hotspots": false }));
      setForecastPredictions(frame);
      setForecastFrame(0);
      setIsPlaying(false);
    } catch (e) {
      console.error("Neighbor prediction failed:", e);
      alert("Neighbor prediction failed: " + (e?.message || e));
    }
  };

  // Seed from Supabase fire_inputs as initial state
  const seedFromFireInputs = async () => {
    try {
      const rows = await fetchRecentFireInputs(50);
      if (!rows || rows.length === 0) {
        alert("No fire_inputs rows found");
        return;
      }
      const points = rows.map((r) => ({
        latitude: r.latitude,
        longitude: r.longitude,
        brightness: r.brightness,
        bright_t31: r.bright_t31,
        confidence: r.confidence,
        daynight: r.daynight,
        elevation: r.elevation,
        slope: r.slope,
        aspect: r.aspect,
        temp: r.temp,
        humidity: r.humidity,
        wind_speed: r.wind_speed,
        precip: r.precip,
        month: r.month,
      }));
      const cluster = { points, clickedPoint: points[0] };
      setSelectedCluster(cluster);
      setPopupPosition(null);
      alert(`Seeded ${points.length} points from fire_inputs`);
    } catch (e) {
      console.error("Seed from fire_inputs failed:", e);
      alert("Seed from fire_inputs failed: " + (e?.message || e));
    }
  };

  // One-click demo: center camera on recent fire_inputs and run neighbor predictions
  const runDemo = async () => {
    try {
      console.log("=== RUN DEMO STARTED ===");
      setStatusMessage("Running demo: fetching seeds...");
      const rows = await fetchRecentFireInputs(50);
      console.log("Fetched fire_inputs rows:", rows?.length);
      
      if (!rows || rows.length === 0) {
        alert("No fire_inputs rows available for demo");
        console.error("No data in fire_inputs table");
        return;
      }
      // Compute centroid of recent rows
      const lat = rows.reduce((s, r) => s + Number(r.latitude || 0), 0) / rows.length;
      const lon = rows.reduce((s, r) => s + Number(r.longitude || 0), 0) / rows.length;

      // Pick up to 12 points nearest the centroid to keep simulation focused
      const withDist = rows.map(r => ({
        row: r,
        d2: (Number(r.latitude) - lat) ** 2 + (Number(r.longitude) - lon) ** 2,
      })).sort((a,b) => a.d2 - b.d2).slice(0, 12).map(x => x.row);

      // Fly the camera
      const globus = globeRef.current && globeRef.current.getGlobus && globeRef.current.getGlobus();
      if (globus?.planet?.camera?.flyLonLat) {
        globus.planet.camera.flyLonLat({ lon, lat, height: 300000 });
      }

      setStatusMessage("Generating 24h forecast...");
      // Build a cluster from recent fire_inputs (include features so server template is rich)
      const points = withDist.map((r) => ({
        latitude: r.latitude,
        longitude: r.longitude,
        brightness: r.brightness,
        bright_t31: r.bright_t31,
        confidence: r.confidence,
        daynight: r.daynight,
        elevation: r.elevation,
        slope: r.slope,
        aspect: r.aspect,
        temp: r.temp,
        humidity: r.humidity,
        wind_speed: r.wind_speed,
        precip: r.precip,
        month: r.month,
      }));
      const cluster = { points, clickedPoint: { latitude: lat, longitude: lon } };
      
      console.log("Cluster created with", cluster.points.length, "points");
      console.log("Calling handleRunForecast...");
      
      await handleRunForecast(cluster, 12);  // Reduced from 24 to 12 hours for faster testing on Render
      
      console.log("handleRunForecast completed");
      setStatusMessage(null);
      setIsPlaying(true);
      console.log("=== RUN DEMO COMPLETED ===");
    } catch (e) {
      console.error("Run Demo failed:", e);
      alert("Run Demo failed: " + (e?.message || e));
      setStatusMessage(null);
    }
  };

  // Handle slider changes for incremental prediction
  useEffect(() => {
    const computeNextStep = async () => {
      if (!simulationId || !forecastPredictions) return;
      
      // If user moved slider forward beyond computed steps, trigger next computation
      if (forecastFrame > maxComputedStep) {
        console.log(`Computing next step: current=${maxComputedStep}, requested=${forecastFrame}`);
        
        try {
          const resp = await runNextTimeStep(
            simulationId,
            maxComputedStep,
            forecastTemplate,
            "random_forest"
          );
          
          console.log(`Computed step ${resp.time_step}:`, resp.count, "predictions");
          
          // Fetch predictions from database
          const preds = await getPredictionsForTimeStep(simulationId, resp.time_step);
          
          // Update forecast data with new predictions
          const pixel = makeForecastPixelGrid(preds.map(p => ({
            time: resp.time_step,
            lat: p.lat,
            lon: p.lon,
            spread_probability: p.spread_probability
          })));
          
          const newFrame = {
            hour: resp.time_step,
            imageDataUrl: pixel.imageDataUrl,
            bbox: pixel.bbox,
            predictions: preds
          };
          
          setForecastPredictions(prev => {
            const updated = [...prev];
            updated[resp.time_step] = newFrame;
            return updated;
          });
          
          setMaxComputedStep(resp.time_step);
        } catch (error) {
          console.error("Failed to compute next step:", error);
        }
      }
    };
    
    computeNextStep();
  }, [forecastFrame, simulationId, maxComputedStep, forecastTemplate]);

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
                onRunPointPrediction={handleRunPointPredictionNeighbors}
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
        <div style={{ marginTop: 8 }}>
          <button onClick={seedFromFireInputs}>Seed from fire_inputs</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={runDemo}>Run Demo</button>
        </div>
      </div>

      {/* Batch fire_inputs processor */}
      <FireInputsProcessor />

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
