import { useState } from "react";
import { runPointPrediction } from "../utils/forecastApi";

export default function ClusterPopup({ 
  cluster, 
  position, 
  onClose, 
  onRunForecast 
}) {
  const [forecastHours, setForecastHours] = useState(12);
  const [isLoading, setIsLoading] = useState(false);
  const [pointPrediction, setPointPrediction] = useState(null);

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

      const res = await runPointPrediction(row, 'random_forest');
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

  const formatDateTime = (dt) => {
    if (!dt) return '—';
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return String(dt);
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
        <h3>🔥 Fire Point Selected</h3>
        <button className="popup-close" onClick={onClose}>×</button>
      </div>
      
      <div className="popup-content">
        <div className="cluster-stats">
          <div className="stat">
            <span className="label">Cluster Size:</span>
            <span className="value">{cluster.points.length} point{cluster.points.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="stat">
            <span className="label">Location:</span>
            <span className="value">
              {cluster.centerLat.toFixed(3)}°, {cluster.centerLon.toFixed(3)}°
            </span>
          </div>
          <div className="stat">
            <span className="label">Point Time:</span>
            <span className="value">
              {formatDateTime(cluster?.clickedPoint?.created_at || cluster?.clickedPoint?.acq_datetime || cluster?.clickedPoint?.datetime || cluster?.points?.[0]?.created_at)}
            </span>
          </div>
          <div className="stat">
            <span className="label">Time Period:</span>
            <span className="value">{cluster.dateRange}</span>
          </div>
          {cluster?.clickedPoint?.brightness && (
            <div className="stat">
              <span className="label">Brightness:</span>
              <span className="value">{cluster.clickedPoint.brightness.toFixed(1)}K</span>
            </div>
          )}
          {cluster?.clickedPoint?.confidence !== undefined && (
            <div className="stat">
              <span className="label">Confidence:</span>
              <span className="value">{cluster.clickedPoint.confidence}%</span>
            </div>
          )}
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

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            className="forecast-button"
            onClick={handleRunPoint}
            disabled={isLoading}
            title="Run instant fire spread prediction for this point"
          >
            <span className="button-icon">🎯</span>
            {isLoading ? "Running..." : "Point Prediction"}
          </button>

          <button 
            className="forecast-button"
            onClick={handleRunForecast}
            disabled={isLoading}
            title="Generate multi-hour fire spread forecast simulation"
          >
            <span className="button-icon">🔮</span>
            {isLoading ? "Generating..." : "Spread Forecast"}
          </button>
        </div>
        
        <div style={{ fontSize: '11px', color: '#aaa', marginTop: 8, textAlign: 'center' }}>
          Click any fire point to run predictions
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
