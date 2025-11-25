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
<<<<<<< HEAD
import SearchBar from "./components/SearchBar";
=======
>>>>>>> e0d14416949a38f37369c54972b3bd6180ce24c8

/* ---- Hooks ---- */
import useTimeline from "./hooks/useTimeline";

export default function App() {
  // Imperative handle to the globe component
  const globeRef = useRef(null);

  // Navigation state
  const [currentView, setCurrentView] = useState('map');

  // Base-map toggle
  const [base, setBase] = useState("OSM");

  // Visualization mode + layer visibility for the left panel
  const [vizMode, setVizMode] = useState("KDE Heatmap");
  const [layers, setLayers] = useState({
    "Predicted Spread": true,
    "2025 Fire Perimeters": true,
    "MODIS Hotspots": true,
  });

  const [model, setModel] = useState("Neural Network");

  const [forecastSettings, setForecastSettings] = useState({
    horizon: "12 hours",
    display: "Heatmap",
    threshold: 75,
  });

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

  // Timeline state (Dallas time)
  const { tz, now, end, sliderIdx, setSliderIdx, selectedDate } =
    useTimeline("America/Chicago");

  const handleBaseChange = (name) => {
    if (name === base) return;
    setBase(name);
    globeRef.current?.setBase?.(name); // call GlobeCanvas' imperative API
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

            <HeatmapOverlayLayer globeRef={globeRef} />

            {/* === Data Layers === */}
            <FiresLayer globus={globeRef.current?.getGlobus?.()} />

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
              />

<<<<<<< HEAD
              <LayerPanel 
                model={model}
                setModel={setModel}
                forecastSettings={forecastSettings}
                setForecastSettings={setForecastSettings}
                onRunForecast={() => console.log('Running forecast with settings:', forecastSettings)}
              />
=======
              <LayerPanel />
>>>>>>> e0d14416949a38f37369c54972b3bd6180ce24c8

              <Timeline
                tz={tz}
                now={now}
                end={end}
                sliderIdx={sliderIdx}
                setSliderIdx={setSliderIdx}
                selectedDate={selectedDate}
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
<<<<<<< HEAD
      <Header 
        currentView={currentView}
        globeRef={globeRef}
        SearchBar={SearchBar}
        onLocationSelect={(location) => {
          console.log('Location selected:', location);
        }}
      />
=======
      <Header />
>>>>>>> e0d14416949a38f37369c54972b3bd6180ce24c8
      {renderContent()}
    </div>
  );
}
