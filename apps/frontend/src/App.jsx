import React, { useMemo, useRef, useEffect, useState } from "react";
import { Globe } from "@openglobus/openglobus-react";
import { OpenStreetMap, GlobusRgbTerrain } from "@openglobus/og";

export default function App() {
  // 1) Intro overlay starts visible
  const [showIntro, setShowIntro] = useState(true);

  // === Timeline (Dallas time): now -> +24h in hourly steps ===
  const TZ = "America/Chicago";
  const HOUR_MS = 3600_000;

  // snap "now" to the top of the hour
  const now = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }, []);

  const end = useMemo(() => new Date(now.getTime() + 24 * HOUR_MS), [now]);

  // 0..24 (inclusive) so the right edge is exactly +24h
  const maxIdx = 24;
  const [sliderIdx, setSliderIdx] = useState(0); // start at "now"

  const selectedDate = useMemo(
    () => new Date(now.getTime() + sliderIdx * HOUR_MS),
    [now, sliderIdx]
  );

  // format helpers (Dallas time)
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
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value || "CT";

  // 3) Globe layers
  const globeRef = useRef(null);

  const terrain = useMemo(
    () =>
      new GlobusRgbTerrain(null, {
        url: "/og-res/tiles/{z}/{x}/{y}.png",
        maxNativeZoom: 12,
        plainGridSize: 32,
      }),
    []
  );

  const osmLayer = useMemo(
    () =>
      new OpenStreetMap(null, {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        subdomains: ["a", "b", "c"],
        attribution: "© OpenStreetMap contributors",
        isBaseLayer: true,
      }),
    []
  );

  // Resize safety (keeps canvas flush with viewport)
  useEffect(() => {
    const onResize = () =>
      document.documentElement.style.setProperty("--vh", `${window.innerHeight}px`);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* GLOBE */}
      <Globe
        ref={globeRef}
        name="Earth"
        terrain={terrain}
        layers={[osmLayer]}
        resourcesSrc="/og-res"
        fontsSrc="/og-res/fonts"
        cameraView={{ lon: -98.583, lat: 39.833, height: 4_500_000 }}
        style={{ zIndex: 1 }}
      />

      {/* UI LAYER (panels, timeline) */}
      <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
        {/* Logo */}
        <img
          src="/FireCast_LOGO.png"
          alt="FireCast"
          style={{
            position: "absolute",
            top: 10,
            left: 20,
            width: 66,
            height: 66,
            userSelect: "none",
            pointerEvents: "none",
            filter: "drop-shadow(0 2px 8px rgba(0,0,0,.5))",
          }}
        />

        {/* LEFT — Orange Glass Panel */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 24,
            transform: "translateY(-50%)",
            width: 300,
            padding: "22px 20px",
            background: "rgba(15, 15, 15, 0.45)",
            border: "1px solid rgba(255, 120, 0, 0.35)",
            borderRadius: 18,
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            backdropFilter: "blur(8px) saturate(150%)",
            color: "#f8f8f8",
            fontFamily: "Inter, sans-serif",
            lineHeight: 1.5,
            pointerEvents: "auto",
            zIndex: 20,
          }}
        >
          <h3
            style={{
              margin: "0 0 10px 0",
              fontSize: 20,
              fontWeight: 600,
              color: "#ff844a",
              letterSpacing: 0.5,
              textShadow: "0 0 8px rgba(255,90,36,0.4)",
            }}
          >
            Wildfire Prediction Panel
          </h3>

          <p style={{ fontSize: 14, opacity: 0.9 }}>
            <strong>(MVP)</strong> Controls for MODIS wildfire layers, predictions, and
            visualization.
          </p>
          <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 0 }}>
            Use the timeline to explore hourly forecasts (Dallas time).
          </p>
        </div>

        {/* RIGHT — Layers Box */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            right: 24,
            transform: "translateY(-50%)",
            width: 240,
            padding: "18px 16px",
            background: "rgba(15, 15, 15, 0.45)",
            border: "1px solid rgba(255, 120, 0, 0.25)",
            borderRadius: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            backdropFilter: "blur(8px)",
            color: "#f8f8f8",
            fontFamily: "Inter, sans-serif",
            pointerEvents: "auto",
            zIndex: 20,
          }}
        >
          <h4
            style={{
              margin: "0 0 12px 0",
              fontSize: 16,
              fontWeight: 500,
              textAlign: "center",
              color: "#ff844a",
              borderBottom: "1px solid rgba(255,120,0,0.25)",
              paddingBottom: 6,
            }}
          >
            Layers
          </h4>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["Predicted Spread", "Fire Perimeters", "MODIS Hotspots", "Wind Direction"].map(
              (label, i) => (
                <label
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    defaultChecked={i % 2 === 0}
                    style={{
                      appearance: "none",
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: "2px solid #ff844a",
                      backgroundColor: i % 2 === 0 ? "#ff844a" : "transparent",
                      transition: "background 0.2s",
                    }}
                    onChange={(e) => {
                      e.target.style.backgroundColor = e.target.checked
                        ? "#ff844a"
                        : "transparent";
                    }}
                  />
                  {label}
                </label>
              )
            )}
          </div>
        </div>

        {/* BOTTOM — Timeline (hourly, now -> +24h; Dallas time) */}
        <div
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            bottom: 30,
            display: "flex",
            alignItems: "center",
            gap: 16,
            pointerEvents: "auto",
            zIndex: 20,
          }}
        >
          <span style={{ color: "#ddd", fontSize: 12 }}>{fmtDateTime(now)}</span>

          <input
            type="range"
            min={0}
            max={maxIdx}
            step={1}
            value={sliderIdx}
            onChange={(e) => setSliderIdx(Number(e.target.value))}
            style={{ flex: 1, height: 4, accentColor: "#ff5a24" }}
            aria-label="Forecast time (hourly, Dallas time)"
          />

          <span style={{ color: "#ddd", fontSize: 12 }}>{fmtDateTime(end)}</span>

          <div
            style={{
              minWidth: 200,
              textAlign: "center",
              color: "#fff",
              background: "rgba(15, 15, 15, 0.45)",
              border: "1px solid rgba(255,120,0,.3)",
              padding: "6px 10px",
              borderRadius: 8,
              backdropFilter: "blur(6px)",
              whiteSpace: "nowrap",
            }}
            title={`${selectedDate.toISOString()}`}
          >
            {fmtDateTime(selectedDate)} {fmtTZShort(selectedDate)}
          </div>
        </div>
      </div>

      {/* INTRO OVERLAY (stays on top; does NOT move side boxes) */}
      {showIntro && (
        <div
          onClick={() => setShowIntro(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            backdropFilter: "blur(3px)",
            display: "grid",
            placeItems: "center",
            pointerEvents: "auto",
            zIndex: 1000,
            transition: "opacity 320ms ease",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 92vw)",
              padding: "42px 28px",
              borderRadius: 16,
              background: "rgba(15, 15, 15, 0.45)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#e8e8e8",
              textAlign: "center",
              boxShadow: "0 20px 60px rgba(0,0,0,.45)",
              backdropFilter: "blur(8px)",
            }}
          >
            <img
              src="/FireCast_LOGO.png"
              alt="FireCast"
              style={{ width: 56, height: 56, marginBottom: 12, userSelect: "none" }}
              draggable="false"
            />
            <h1 style={{ margin: "0 0 8px 0", fontWeight: 500, letterSpacing: 0.5 }}>
              Fire CastX
            </h1>
            <p style={{ margin: 0, opacity: 0.9 }}>Fires around the U.S in one place.</p>
            <div style={{ marginTop: 18, fontSize: 12, opacity: 0.85 }}>
              Click anywhere to continue
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
