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

/* ---- Hooks ---- */
import useTimeline from "./hooks/useTimeline";

export default function App() {
  // Imperative handle to the globe component
  const globeRef = useRef(null);

  // Base-map toggle
  const [base, setBase] = useState("OSM");

  // Visualization mode + layer visibility for the left panel
  const [vizMode, setVizMode] = useState("KDE Heatmap");
  const [layers, setLayers] = useState({
    "Predicted Spread": true,
    "Fire Perimeters": true,
    "MODIS Hotspots": true,
  });

  const [model, setModel] = useState("Neural Network");

  const [forecastSettings, setForecastSettings] = useState({
    horizon: "24 hours",
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

  // Timeline state (Dallas time)
  const { tz, now, end, sliderIdx, setSliderIdx, selectedDate } =
    useTimeline("America/Chicago");

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

      {/* === Data Layers === */}
      <FiresLayer globus={globeRef.current?.getGlobus?.()} />

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