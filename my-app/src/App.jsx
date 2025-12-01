import { useMemo, useRef, useState, useEffect } from "react";
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

/* ---- Hooks ---- */
import useTimeline from "./hooks/useTimeline";

/* ---- Utils ---- */
import { generateSpreadForecast } from "./utils/forecastApi";
import makeForecastHeatmap from "./utils/makeForecastHeatmap";

export default function App() {
  // Imperative handle to the globe component
  const globeRef = useRef(null);
  
  // Track when globe is ready
  const [globeReady, setGlobeReady] = useState(false);

  // Navigation state
  const [currentView, setCurrentView] = useState('map');

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
      const hash = window.location.hash.slice(1); // Remove the #
      if (hash === '/creators') {
        setCurrentView('creators');
      } else if (hash === '/api') {
        setCurrentView('api');
      } else if (hash === '/sources') {
        setCurrentView('sources');
      } else if (hash === '/docs') {
        setCurrentView('docs');
      } else {
        setCurrentView('map');
      }
    };

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    // Handle initial hash
    handleHashChange();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Check when globe is ready
  useEffect(() => {
    const checkGlobe = setInterval(() => {
      if (globeRef.current?.getGlobus?.()) {
        setGlobeReady(true);
        clearInterval(checkGlobe);
      }
    }, 100);
    
    return () => clearInterval(checkGlobe);
  }, []);

  // Timeline state (Dallas time) - now connected to date range
  const { tz, now, end, sliderIdx, setSliderIdx, selectedDate, maxHours } =
    useTimeline("America/Chicago", startDate, endDate);

  const handleBaseChange = (name) => {
    if (name === base) return;
    setBase(name);
    globeRef.current?.setBase?.(name); // call GlobeCanvas' imperative API
  };

  // Handle cluster click
  const handleClusterClick = (cluster, position) => {
    setSelectedCluster(cluster);
    setPopupPosition(position);
    // Stop any running forecast
    setIsPlaying(false);
  };

  // Handle run forecast
  const handleRunForecast = async (cluster, forecastHours) => {
    try {
      console.log("Running forecast for cluster:", cluster);
      
      // Close popup
      setSelectedCluster(null);
      setPopupPosition(null);
      
      // Generate predictions
      const predictions = await generateSpreadForecast(
        cluster.points, 
        forecastHours,
        "neural_network"
      );
      
      // Group predictions by hour and generate heatmaps
      const predictionsByHour = {};
      predictions.forEach(pred => {
        const hour = pred.time || 0;
        if (!predictionsByHour[hour]) {
          predictionsByHour[hour] = [];
        }
        predictionsByHour[hour].push(pred);
      });
      
      // Generate heatmap for each time step
      const forecastData = Object.keys(predictionsByHour)
        .sort((a, b) => Number(a) - Number(b))
        .map(hour => {
          const preds = predictionsByHour[hour];
          const { imageDataUrl, bbox } = makeForecastHeatmap(preds);
          return {
            hour: Number(hour),
            imageDataUrl,
            bbox,
            predictions: preds
          };
        });
      
      setForecastPredictions(forecastData);
      setForecastFrame(0);
      setIsPlaying(true);
      
    } catch (error) {
      console.error("Forecast generation failed:", error);
      alert("Failed to generate forecast. Please try again.");
    }
  };

  // Animation playback control
  useEffect(() => {
    if (!isPlaying || !forecastPredictions || forecastPredictions.length === 0) {
      return;
    }
    
    const interval = setInterval(() => {
      setForecastFrame(frame => {
        const nextFrame = frame + 1;
        if (nextFrame >= forecastPredictions.length) {
          setIsPlaying(false);
          return frame; // Stay at last frame
        }
        return nextFrame;
      });
    }, 1000 / playbackSpeed); // Adjust speed
    
    return () => clearInterval(interval);
  }, [isPlaying, forecastPredictions, playbackSpeed]);

  const handleForecastPlayPause = () => {
    if (forecastFrame >= forecastPredictions.length - 1) {
      // Restart from beginning if at end
      setForecastFrame(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
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
  };

  const renderContent = () => {
    switch (currentView) {
      case 'creators':
        return <Creators />;
      case 'api':
        return (
          <div className="page-content">
            <h1>API Documentation</h1>
            <p>API documentation coming soon...</p>
          </div>
        );
      case 'sources':
        return (
          <div className="page-content">
            <h1>Data Sources</h1>
            <p>Data sources information coming soon...</p>
          </div>
        );
      case 'docs':
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

            {/* Only render data layers once globe is ready */}
            {globeReady && (
              <>
                <HeatmapOverlayLayer globeRef={globeRef} startDate={selectedDate} endDate={endDate} />
                {layers["MODIS Hotspots"] && (
                  <FiresLayer 
                    globus={globeRef.current?.getGlobus?.()} 
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
            {forecastPredictions && (
              <ForecastControls
                isPlaying={isPlaying}
                currentHour={forecastPredictions[forecastFrame]?.hour || 0}
                totalHours={forecastPredictions[forecastPredictions.length - 1]?.hour || 0}
                onPlayPause={handleForecastPlayPause}
                onSeek={handleForecastSeek}
                onStop={handleForecastStop}
                onSpeedChange={setPlaybackSpeed}
                speed={playbackSpeed}
              />
            )}

            {/* === Overlay UI === */}
            <div className="ui-overlay">
              {/* === Change to layers panel === */}
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

            {/* === Intro === */}
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
          console.log('Location selected:', location);
        }}
      />
      {renderContent()}
    </div>
  );
}
