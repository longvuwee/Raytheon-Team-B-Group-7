import CollapsiblePanel from "./CollapsiblePanel";

export default function LayerPanel({
  items = ["Predicted Spread", "Fire Perimeters", "MODIS Hotspots", "Wind Direction"],
}) {
  return (
    <CollapsiblePanel side="right" title="Layers" defaultOpen={true}>
      <div className="layer-list">
        {items.map((label, i) => (
          <label key={label} className="layer-item">
            <input type="checkbox" defaultChecked={i % 2 === 0} className="layer-checkbox" />
            {label}
          </label>
        ))}
      </div>
    </CollapsiblePanel>
  );
}
