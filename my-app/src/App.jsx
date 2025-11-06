import { useMemo, useRef, useState } from "react";
import "./index.css";
import "./App.css";

/* ---- Components ---- */
import GlobeCanvas from "./components/GlobeCanvas";
import FiresLayer from "./components/FiresLayer";
import BaseSwitch from "./components/BaseSwitch";
import Timeline from "./components/Timeline";
import IntroOverlay from "./components/IntroOverlay";
import LeftInfoPanel from "./components/LeftInfoPanel";
import LayerPanel from "./components/LayerPanel";
import Logo from "./components/Logo";
import Header from "./components/Header";

/* ---- Hooks ---- */
import useTimeline from "./hooks/useTimeline";

export default function App() {
  // Imperative handle to the globe component
  const globeRef = useRef(null);

  // Base-map toggle
  const [base, setBase] = useState("OSM");

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
        <LeftInfoPanel />

        <LayerPanel />

        <BaseSwitch value={base} onChange={handleBaseChange} />

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