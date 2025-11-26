import { useMemo, useRef, useState } from "react";
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


/* ---- Hooks ---- */
import useTimeline from "./hooks/useTimeline";

export default function App() {
  // Imperative handle to the globe component
  const globeRef = useRef(null);

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

  // Model and forecast settings for the right panel
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

  // Timeline state with custom date range
  const { tz, now, end, sliderIdx, setSliderIdx, selectedDate, maxHours } =
    useTimeline("America/Chicago", startDate, endDate);

  const handleBaseChange = (name) => {
    if (name === base) return;
    setBase(name);
    globeRef.current?.setBase?.(name); // call GlobeCanvas' imperative API
  };

  return (
    <div className="app-root">
      {/* === Globe === */}
      <GlobeCanvas
        ref={globeRef}
        className="globe"
        initialView={initialView}
      />

      <HeatmapOverlayLayer globeRef={globeRef} selectedDate={selectedDate} />

      {/* === Data Layers === */}
      <FiresLayer globus={globeRef.current?.getGlobus?.()} selectedDate={selectedDate} />

      {/* === Overlay UI === */}
      <div className="ui-overlay">
        <Header />

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

        {/* <BaseSwitch value={base} onChange={handleBaseChange} /> */}

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
    </div>
  );
}
