import CollapsiblePanel from "./CollapsiblePanel";

export default function LeftInfoPanel({
  offsetLeft = 0,
  behindSidebar = false,

  baseMap = "OSM",
  onBaseMapChange = () => {},

  vizMode = "KDE Heatmap",
  setVizMode = () => {},

  layers = {
    "Predicted Spread": true,
    "2025 Fire Perimeters": true,
    "MODIS Hotspots": true,
  },
  setLayers = () => {},
}) {
  const handleLayerChange = (key) => {
    setLayers({
      ...layers,
      [key]: !layers[key],
    });
  };

  return (
    <CollapsiblePanel
      side="left"
      title="Map & Layer Controls"
      defaultOpen={true}
      offsetLeft={offsetLeft}
      behindSidebar={behindSidebar}
    >
      {/* === Base Map as OSM / SAT / Topo buttons === */}
      <section className="panel-section">
        <label className="field-label">Base Map</label>
        <div className="base-button-row">
          {["OSM", "SAT"].map((name) => (
            <button
              key={name}
              className={`btn ${baseMap === name ? "btn-disabled" : ""}`}
              onClick={() => onBaseMapChange(name)}
              disabled={baseMap === name}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="field-helper">
          Choose the underlying map style or satellite view.
        </p>
      </section>

      {/* === Visualization Mode === */}
      <section className="panel-section">
        <label className="field-label">Visualization Mode</label>
        <select
          className="field-select"
          value={vizMode}
          onChange={(e) => setVizMode(e.target.value)}
        >
          <option value="KDE Heatmap">KDE Heatmap</option>
          <option value="Pinpoints">Pinpoints</option>
          <option value="Scaled Points">Scaled Points</option>
        </select>
        <p className="field-helper">
          Controls how predicted fire risk is represented visually.
        </p>
      </section>

      {/* === Layer Toggles === */}
      <section className="panel-section">
        <label className="field-label">Map Layers</label>
        <div className="field-box">
          {Object.keys(layers).map((key) => (
            <label key={key} className="checkbox-row">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => handleLayerChange(key)}
              />
              <span>{key}</span>
            </label>
          ))}
        </div>
        <p className="field-helper">
          Enable or disable specific wildfire data layers.
        </p>
      </section>
    </CollapsiblePanel>
  );
}
