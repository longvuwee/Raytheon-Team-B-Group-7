import { useState } from "react";
import CollapsiblePanel from "./CollapsiblePanel";

export default function RightInfoPanel() {
  const [activeWeatherLegend, setActiveWeatherLegend] = useState(null);

  return (
    <CollapsiblePanel side="right" title="Legends" defaultOpen={false}>
      <section className="panel-section">

        {/* ==== FIRE SPREAD LEGEND ==== */}
        <div className="field-label">Fire Spread Legend</div>

        <div className="legend-card">
          <div className="legend-items">
            <div className="legend-item">
              <div
                className="legend-color"
                style={{
                  backgroundColor: "rgba(128, 128, 128, 0.8)",
                  border: "2px solid #808080",
                }}
              />
              <span className="legend-text">Initial Ignition (0–3 Hours)</span>
            </div>

            <div className="legend-item">
              <div
                className="legend-color"
                style={{
                  backgroundColor: "rgba(255, 200, 50, 0.8)",
                  border: "2px solid #FFC832",
                }}
              />
              <span className="legend-text">Early Spread (3–6 Hours)</span>
            </div>

            <div className="legend-item">
              <div
                className="legend-color"
                style={{
                  backgroundColor: "rgba(255, 150, 50, 0.8)",
                  border: "2px solid #FF9632",
                }}
              />
              <span className="legend-text">Active Spread (6–12 Hours)</span>
            </div>

            <div className="legend-item">
              <div
                className="legend-color"
                style={{
                  backgroundColor: "rgba(255, 50, 50, 0.8)",
                  border: "2px solid #FF3232",
                }}
              />
              <span className="legend-text">Extended Burn (12+ Hours)</span>
            </div>

            <div className="legend-item">
              <div
                className="legend-color"
                style={{
                  backgroundColor: "rgba(60, 60, 60, 0.8)",
                  border: "2px solid #3C3C3C",
                }}
              />
              <span className="legend-text">Fully Burned Areas</span>
            </div>
          </div>

          <p className="field-helper" style={{ marginTop: "0.75rem" }}>
            Fire progression visualization from ignition to complete burn.
          </p>
        </div>

        {/* ==== WEATHER LEGENDS ==== */}
        <div className="field-label" style={{ marginTop: "1rem" }}>
          Weather Legends
        </div>

        <div className="weather-legend-container">

          {/* TABS OUTSIDE THE BOX */}
          <div className="weather-legend-header">
            {["Precipitation", "Temperature", "Wind Speed"].map((label) => (
              <button
                key={label}
                type="button"
                className={
                  "weather-tab-btn" +
                  (activeWeatherLegend === label ? " weather-tab-btn-active" : "")
                }
                onClick={() => setActiveWeatherLegend(label)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* SINGLE BOX FOR WEATHER LEGEND */}
          <div className="legend-card weather-legend-body">
            {activeWeatherLegend === "Precipitation" && (
              <div className="legend-items">
                <div className="legend-item">
                  <div className="legend-color precip-light" />
                  <span className="legend-text">Light precipitation</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color precip-medium" />
                  <span className="legend-text">Moderate rain / showers</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color precip-heavy" />
                  <span className="legend-text">Heavy rain / storms</span>
                </div>
              </div>
            )}

            {activeWeatherLegend === "Temperature" && (
              <div className="legend-items">
                <div className="legend-item">
                  <div className="legend-color temp-cold" />
                  <span className="legend-text">Colder / cooler areas</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color temp-mild" />
                  <span className="legend-text">Mild / moderate temps</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color temp-hot" />
                  <span className="legend-text">Hot / heat-prone areas</span>
                </div>
              </div>
            )}

            {activeWeatherLegend === "Wind Speed" && (
              <div className="legend-items">
                <div className="legend-item">
                  <div className="legend-color wind-low" />
                  <span className="legend-text">Light winds</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color wind-medium" />
                  <span className="legend-text">Moderate / breezy</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color wind-strong" />
                  <span className="legend-text">Strong / high-risk winds</span>
                </div>
              </div>
            )}

            {!activeWeatherLegend && (
              <p className="field-helper">
                Select a tab above to see how colors map to each overlay.
              </p>
            )}
          </div>
        </div>
      </section>
    </CollapsiblePanel>
  );
}
