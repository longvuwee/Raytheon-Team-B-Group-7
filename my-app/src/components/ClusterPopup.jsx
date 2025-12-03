import { useState } from "react";
import { runPointPrediction } from "../utils/forecastApi";

export default function ClusterPopup({ 
  cluster, 
  position, 
  onClose, 
  onRunForecast
}) {
  const [forecastHours, setForecastHours] = useState(24);
  const [isLoading, setIsLoading] = useState(false);
  const [pointPrediction, setPointPrediction] = useState(null);
  const [selectedModel, setSelectedModel] = useState('random_forest');

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

  // Run a single-point prediction for the first point in the cluster
  const handleRunPoint = async () => {
    if (!cluster?.points?.length) return;
    setIsLoading(true);
    try {
      const row = cluster.points[0];
      // Ensure an id exists (fallback to timestamp-based id)
      if (!row.id) row.id = `${Date.now()}-${row.latitude}-${row.longitude}`;

      const res = await runPointPrediction(row, selectedModel);
      setPointPrediction(res);
    } catch (err) {
      console.error('Point prediction failed', err);
      setPointPrediction({ error: err.message || 'Prediction failed' });
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

  // removed unused formatDateTime helper

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
            <span className="label">Fire Date:</span>
            <span className="value">
              {(cluster.fireDate) || (() => {
                const dt = cluster?.clickedPoint?.created_at || cluster?.points?.[0]?.created_at;
                try { return dt ? new Date(dt).toISOString().split('T')[0] : '—'; } catch { return String(dt || '—'); }
              })()}
            </span>
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
          
          <label className="forecast-label" style={{ marginTop: 8 }}>
            Point Prediction Model:
            <select 
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              className="forecast-select"
            >
              <option value="random_forest">Random Forest</option>
              <option value="logreg">Logistic Regression</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            className="forecast-button"
            onClick={handleRunPoint}
            disabled={isLoading}
            title="Run a single-point prediction for the first point in this cluster"
          >
            <span className="button-icon">🎯</span>
            {isLoading ? "Running..." : "Run Point Prediction"}
          </button>

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
      {pointPrediction && (
        <div className="popup-footer" style={{ marginTop: 12 }}>
          <h4>Point Prediction</h4>
          {pointPrediction.error ? (
            <div style={{ color: 'var(--danger)' }}>{pointPrediction.error}</div>
          ) : (
            <div>
              <div>Model: {pointPrediction.model}</div>
              <div>Probability: {(pointPrediction.instant_spread_probability ?? pointPrediction.spread_probability ?? 0).toFixed(3)}</div>
              <div>Prediction: {pointPrediction.prediction}</div>
              <div>T: {pointPrediction.T ?? pointPrediction.t ?? '—'}</div>
              <div>T_burn: {pointPrediction.T_burn ?? pointPrediction.t_burn ?? '—'}</div>
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
