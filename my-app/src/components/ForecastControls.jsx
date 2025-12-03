export default function ForecastControls({ 
  isPlaying, 
  currentHour, 
  totalHours,
  onPlayPause,
  onSeek,
  onStop,
  onSpeedChange,
  speed = 1
}) {
  return (
    <div className="forecast-controls">
      <div className="forecast-header">
        <div className="forecast-info">
          <span className="forecast-icon">🔮</span>
          <span className="forecast-label">Fire Spread Forecast</span>
          <span className="forecast-time">
            +{currentHour}h of +{totalHours}h
          </span>
        </div>
        <button className="forecast-close" onClick={onStop} title="Stop Forecast">
          ×
        </button>
      </div>
      
      <div className="playback-controls">
        <button 
          className="playback-button" 
          onClick={onPlayPause}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        
        <div className="forecast-slider-container">
          <input 
            type="range" 
            min="0" 
            max={totalHours}
            value={currentHour}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="forecast-slider"
          />
          <div className="slider-markers">
            <span>0h</span>
            <span>+{Math.floor(totalHours / 2)}h</span>
            <span>+{totalHours}h</span>
          </div>
        </div>

        <div className="speed-control">
          <label className="speed-label">Speed:</label>
          <select 
            value={speed} 
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="speed-select"
          >
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
        </div>
      </div>
    </div>
  );
}
