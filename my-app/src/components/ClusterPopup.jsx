import { useState } from "react";

export default function ClusterPopup({ 
  cluster, 
  position, 
  onClose, 
  onRunForecast 
}) {
  const [forecastHours, setForecastHours] = useState(24);
  const [isLoading, setIsLoading] = useState(false);

  const handleRunForecast = async () => {
    setIsLoading(true);
    try {
      await onRunForecast(cluster, forecastHours);
    } catch (err) {
      console.error("Forecast error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackdropClick = (e) => {
    // Only close if clicking directly on the backdrop (not the popup itself)
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      onClose();
    }
  };

  // Determine if popup should open below (true) or above (false) the point
  // Check if there's enough space above (popup height ~350-400px + 20px offset)
  const requiredSpaceAbove = 420;
  const openBelow = position.y < requiredSpaceAbove;

  return (
    <div className="popup-backdrop" onClick={handleBackdropClick}>
      <div 
        className={`cluster-popup ${openBelow ? 'popup-below' : ''}`}
        style={{ 
          left: `${position.x}px`, 
          top: `${position.y}px` 
        }}
        onClick={(e) => e.stopPropagation()}
      >
      <div className="popup-header">
        <h3>🔥 Fire Cluster</h3>
        <button className="popup-close" onClick={onClose}>×</button>
      </div>
      
      <div className="popup-content">
        <div className="cluster-stats">
          <div className="stat">
            <span className="label">Fire Points:</span>
            <span className="value">{cluster.points.length}</span>
          </div>
          <div className="stat">
            <span className="label">Location:</span>
            <span className="value">
              {cluster.centerLat.toFixed(3)}°, {cluster.centerLon.toFixed(3)}°
            </span>
          </div>
          <div className="stat">
            <span className="label">Time Period:</span>
            <span className="value">{cluster.dateRange}</span>
          </div>
        </div>
        
        <div className="forecast-options">
          <label className="forecast-label">
            Forecast Duration:
            <select 
              value={forecastHours} 
              onChange={(e) => setForecastHours(Number(e.target.value))}
              className="forecast-select"
            >
              <option value="6">6 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
            </select>
          </label>
        </div>

        <button 
          className="forecast-button"
          onClick={handleRunForecast}
          disabled={isLoading}
        >
          <span className="button-icon">🔮</span>
          {isLoading ? "Generating Forecast..." : "Run Spread Forecast"}
        </button>
      </div>
    </div>
    </div>
  );
}
