export default function LayerPanel({ items=["Predicted Spread","Fire Perimeters","MODIS Hotspots","Wind Direction"] }) {
  return (
    <div className="panel panel-right">
      <h4 className="panel-subtitle">Layers</h4>
      <div className="layer-list">
        {items.map((label,i)=>(
          <label key={label} className="layer-item">
            <input type="checkbox" defaultChecked={i%2===0} className="layer-checkbox" />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
