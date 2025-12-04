import { useState } from "react";
import CollapsiblePanel from "./CollapsiblePanel";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";

export default function LeftInfoPanel({
  offsetLeft = 0,
  behindSidebar = false,

  baseMap = "OSM",
  onBaseMapChange = () => {},

  layers = {
    "Predicted Spread": true,
    "MODIS Hotspots": true,
  },
  setLayers = () => {},

  startDate = new Date(),
  endDate = new Date(),
  onStartDateChange = () => {},
  onEndDateChange = () => {},
  confidenceThreshold = 80,
  onConfidenceChange = () => {},
}) {
  const handleLayerChange = (key) => {
    setLayers({
      ...layers,
      [key]: !layers[key],
    });
  };

  // Local state for weather layer toggles
  const [weatherLayers, setWeatherLayers] = useState({
    Clouds: true,
    Precipitation: false,
    Temperature: false,
    "Wind Speed": false,
  });

  const applyWeatherVisibility = (next) => {
    const wl = window.ogWeatherLayers;
    if (!wl) return;
    if ("Clouds" in next && wl.clouds) {
      wl.clouds.setVisibility(next["Clouds"]);
    }
    if ("Precipitation" in next && wl.precip) {
      wl.precip.setVisibility(next["Precipitation"]);
    }
    if ("Temperature" in next && wl.temp) {
      wl.temp.setVisibility(next["Temperature"]);
    }
    if ("Wind Speed" in next && wl.wind) {
      wl.wind.setVisibility(next["Wind Speed"]);
    }
  };

  const handleWeatherChange = (key) => {
    setWeatherLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      applyWeatherVisibility(next);
      return next;
    });
  };

  const handleStartDateChange = (newValue) => {
    if (newValue && newValue.isValid()) {
      const date = newValue.toDate();
      date.setHours(0, 0, 0, 0);
      onStartDateChange(date);
    }
  };

  const handleEndDateChange = (newValue) => {
    if (newValue && newValue.isValid()) {
      const date = newValue.toDate();
      date.setHours(23, 59, 59, 999);
      onEndDateChange(date);
    }
  };

  return (
    <CollapsiblePanel
      side="left"
      title="Map & Layer Controls"
      defaultOpen={true}
      offsetLeft={offsetLeft}
      behindSidebar={behindSidebar}
    >
      {/* === Date Range Selection === */}
      <section className="panel-section">
        <label className="field-label">Date Range</label>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <div className="date-range-inputs">
            <div className="date-input-group">
              <label className="date-sublabel">Start Date</label>
              <DatePicker
                value={dayjs(startDate)}
                onChange={handleStartDateChange}
                maxDate={dayjs(endDate)}
                format="MM/DD/YYYY"
                slotProps={{
                  textField: {
                    className: "mui-date-picker",
                    placeholder: "MM/DD/YYYY",
                  },
                }}
              />
            </div>
            <div className="date-input-group">
              <label className="date-sublabel">End Date</label>
              <DatePicker
                value={dayjs(endDate)}
                onChange={handleEndDateChange}
                minDate={dayjs(startDate)}
                format="MM/DD/YYYY"
                slotProps={{
                  textField: {
                    className: "mui-date-picker",
                    placeholder: "MM/DD/YYYY",
                  },
                }}
              />
            </div>
          </div>
        </LocalizationProvider>
        <p className="field-helper">
          Select a date range to visualize fire data. Use the timeline slider to
          navigate hours within this range.
        </p>
        <div className="field-box" style={{ marginTop: 8 }}>
          <label className="field-label" htmlFor="confidence-threshold">
            Confidence ≥ {confidenceThreshold}%
          </label>
          <input
            id="confidence-threshold"
            type="range"
            min="0"
            max="100"
            step="1"
            value={confidenceThreshold}
            onChange={(e) => onConfidenceChange(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
        <p className="field-helper">
          Adjusts the minimum detection confidence for points and heatmap. Move right to show only higher-certainty hotspots.
        </p>
      </section>

      {/* === Base Map as OSM / SAT buttons === */}
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

      {/* === Wildfire Layer Toggles === */}
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
              <span>{key === "Predicted Spread" ? "KDE Heatmap" : key}</span>
            </label>
          ))}
        </div>
        <p className="field-helper">
          Enable or disable specific wildfire data layers.
        </p>
      </section>

      {/* === Weather Layers === */}
      <section className="panel-section">
        <label className="field-label">Weather Layers</label>
        <div className="field-box">
          {Object.keys(weatherLayers).map((key) => (
            <label key={key} className="checkbox-row">
              <input
                type="checkbox"
                checked={weatherLayers[key]}
                onChange={() => handleWeatherChange(key)}
              />
              <span>{key}</span>
            </label>
          ))}
        </div>
        <p className="field-helper">
          Overlay live weather context such as clouds, precipitation, and wind.
        </p>
      </section>
    </CollapsiblePanel>
  );
}
