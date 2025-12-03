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
            <span className="legend-text">0-3h since initial burn</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(255, 200, 50, 0.8)', 
              border: '2px solid #FFC832' 
            }}></div>
            <span className="legend-text">3-6h since initial burn</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(255, 150, 50, 0.8)', 
              border: '2px solid #FF9632' 
            }}></div>
            <span className="legend-text">6-12h since initial burn</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(255, 50, 50, 0.8)', 
              border: '2px solid #FF3232' 
            }}></div>
            <span className="legend-text">12h+ since initial burn</span>
          </div>
          
          <div className="legend-item">
            <div className="legend-color" style={{ 
              backgroundColor: 'rgba(60, 60, 60, 0.8)', 
              border: '2px solid #3C3C3C' 
            }}></div>
            <span className="legend-text">Burned Cells</span>
          </div>
        </div>
        
        <p className="field-helper" style={{ marginTop: '1rem' }}>
          This legend shows the fire spread progression over time, from initial burn to fully burned cells.
        </p>
      </section>
    </CollapsiblePanel>
  );
}
