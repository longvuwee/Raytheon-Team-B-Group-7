import CollapsiblePanel from "./CollapsiblePanel";

export default function LeftInfoPanel() {
  return (
    <CollapsiblePanel side="left" title="Wildfire Prediction Panel" defaultOpen={true}>
      <p className="panel-text">
        <strong>(MVP)</strong> Controls for hotspots, perimeters, and forecasts.
      </p>
      <p className="panel-text subtle">
        Use the timeline to explore hourly forecasts (Dallas time).
      </p>
    </CollapsiblePanel>
  );
}
