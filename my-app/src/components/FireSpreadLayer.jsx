import { useEffect, useRef } from "react";
import { GeoImage } from "@openglobus/og";

/**
 * Renders animated fire spread predictions as overlays on the globe
 */
export default function FireSpreadLayer({ 
  globeRef, 
  predictions, 
  currentFrame,
  opacity = 0.7 
}) {
  const layersRef = useRef([]);

  useEffect(() => {
    const globus = globeRef.current?.getGlobus?.();
    if (!globus || !predictions || predictions.length === 0) return;

    // Clean up old layers
    layersRef.current.forEach(layer => {
      if (globus.planet) {
        globus.planet.removeLayer(layer);
      }
    });
    layersRef.current = [];

    // Create layers for each time step
    predictions.forEach((predictionData, index) => {
      if (!predictionData.imageDataUrl || !predictionData.bbox) return;

      const [minLon, minLat, maxLon, maxLat] = predictionData.bbox;

      const layer = new GeoImage(`Fire Spread +${predictionData.hour}h`, {
        src: predictionData.imageDataUrl,
        corners: [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
        ],
        visibility: index === currentFrame,
        isBaseLayer: false,
        opacity: opacity,
      });

      globus.planet.addLayer(layer);
      layersRef.current.push(layer);
    });

    return () => {
      // Cleanup on unmount
      layersRef.current.forEach(layer => {
        if (globus.planet) {
          globus.planet.removeLayer(layer);
        }
      });
      layersRef.current = [];
    };
  }, [globeRef, predictions, opacity]);

  // Update visibility based on current frame
  useEffect(() => {
    layersRef.current.forEach((layer, index) => {
      layer.setVisibility(index === currentFrame);
    });
  }, [currentFrame]);

  return null;
}
