import { useState } from "react";
import CollapsiblePanel from "./CollapsiblePanel";
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';

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

  startDate = new Date(),
  endDate = new Date(),
  onStartDateChange = () => {},
  onEndDateChange = () => {},
}) {
  const handleLayerChange = (key) => {
    setLayers({
      ...layers,
      [key]: !layers[key],
    });
  };

  const handleStartDateChange = (newValue) => {
    // Only update if the date is valid
    if (newValue && newValue.isValid()) {
      const date = newValue.toDate();
      date.setHours(0, 0, 0, 0);
      onStartDateChange(date);
    }
  };

  const handleEndDateChange = (newValue) => {
    // Only update if the date is valid
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
                    className: 'mui-date-picker',
                    placeholder: 'MM/DD/YYYY',
                  }
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
                    className: 'mui-date-picker',
                    placeholder: 'MM/DD/YYYY',
                  }
                }}
              />
            </div>
          </div>
        </LocalizationProvider>
        <p className="field-helper">
          Select a date range to visualize fire data. Use the timeline slider to navigate hours within this range.
        </p>
      </section>

      {/* === Base Map as OSM / SAT / Topo buttons === */}
      <section className="panel-section">
        <label className="field-label">Base Map</label>
        <div className="base-button-row">
          {["OSM", "SAT", "Topography"].map((name) => (
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
