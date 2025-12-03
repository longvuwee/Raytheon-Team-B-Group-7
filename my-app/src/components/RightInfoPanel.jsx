import CollapsiblePanel from "./CollapsiblePanel";

export default function RightInfoPanel() {
  return (
    <CollapsiblePanel
      side="right"
      title="Fire Spread Legend"
      defaultOpen={false}
    >
      <section className="panel-section">
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(128, 128, 128, 0.8)', 
              border: '2px solid #808080' 
            }}></div>
            <span className="legend-text">Initial Ignition (0-3 Hours)</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(255, 200, 50, 0.8)', 
              border: '2px solid #FFC832' 
            }}></div>
            <span className="legend-text">Early Spread (3-6 Hours)</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(255, 150, 50, 0.8)', 
              border: '2px solid #FF9632' 
            }}></div>
            <span className="legend-text">Active Spread (6-12 Hours)</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(255, 50, 50, 0.8)', 
              border: '2px solid #FF3232' 
            }}></div>
            <span className="legend-text">Extended Burn (12+ Hours)</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(60, 60, 60, 0.8)', 
              border: '2px solid #3C3C3C' 
            }}></div>
            <span className="legend-text">Fully Burned Areas</span>
          </div>
        </div>
        
        <p className="field-helper" style={{ marginTop: '1rem' }}>
          Fire progression visualization showing temporal spread patterns from ignition to complete burn phases.
        </p>
      </section>
    </CollapsiblePanel>
  );
}
