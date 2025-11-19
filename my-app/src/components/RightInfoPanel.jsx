import CollapsiblePanel from "./CollapsiblePanel";

export default function RightInfoPanel({
  model,
  setModel,
  confidence = "—",
  lastUpdated = "—",
  onRunForecast = () => {},
  forecastSettings = {},
  setForecastSettings = () => {},
}) {
  const horizon = forecastSettings.horizon || "12 hours";
  const display = forecastSettings.display || "Heatmap";
  const threshold = forecastSettings.threshold ?? 75;

  const updateSettings = (patch) =>
    setForecastSettings({ ...forecastSettings, ...patch });

  return (
    <CollapsiblePanel
      side="right"
      title="Prediction Settings"
      defaultOpen={true}
    >
      {/* === Model selection + info === */}
      <section className="panel-section">
        <label className="field-label">Model</label>
        <select
          className="field-select"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option>Neural Network</option>
          <option>Random Forest</option>
          <option>Logistic Regression</option>
        </select>

        <div className="field-box" style={{ marginTop: "0.5rem" }}>
          <p className="panel-text">
            <strong>Active Model:</strong> {model}
          </p>
          <p className="panel-text">
            <strong>Confidence:</strong> {confidence}
          </p>
          <p className="panel-text">
            <strong>Last Updated:</strong> {lastUpdated}
          </p>
          <p className="field-helper">
            Three separate models are trained on the same wildfire dataset:
            a Neural Network, Random Forest, and Logistic Regression. The
            interface lets users switch between them to compare forecasts.
          </p>
        </div>
      </section>

      {/* === Forecast controls === */}
      <section className="panel-section">
        <label className="field-label">Forecast Horizon</label>
        <select
          className="field-select"
          value={horizon}
          onChange={(e) => updateSettings({ horizon: e.target.value })}
        >
          <option>6 hours</option>
          <option>12 hours</option>
        </select>

        <label className="field-label" style={{ marginTop: "0.75rem" }}>
          Risk Display
        </label>
        <select
          className="field-select"
          value={display}
          onChange={(e) => updateSettings({ display: e.target.value })}
        >
          <option>Heatmap</option>
          <option>High-risk zones</option>
          <option>All areas</option>
        </select>

        <label className="field-label" style={{ marginTop: "0.75rem" }}>
          Risk Threshold
        </label>
        <div className="field-box">
          <input
            type="range"
            min="0"
            max="100"
            value={threshold}
            onChange={(e) =>
              updateSettings({ threshold: Number(e.target.value) })
            }
          />
          <div className="range-label">{threshold}%</div>
        </div>
        <p className="field-helper">
          Controls which predicted risk levels are highlighted on the map.
        </p>

        {/* Debug-style summary so you can SEE changes */}
        <p className="field-helper">
          Current settings: {horizon}, {display}, threshold {threshold}%.
        </p>

        <button className="run-btn" onClick={onRunForecast}>
          Run Forecast
        </button>
      </section>
    </CollapsiblePanel>
  );
}
