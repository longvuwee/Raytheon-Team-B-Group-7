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
    console.log("[FireSpreadLayer] Received predictions:", predictions?.length, "frames");
    console.log("[FireSpreadLayer] Current frame:", currentFrame);
    
    const globus = globeRef.current?.getGlobus?.();
    if (!globus) {
      console.warn("[FireSpreadLayer] No globus instance available");
      return;
    }
    if (!predictions || predictions.length === 0) {
      console.warn("[FireSpreadLayer] No predictions to display");
      return;
    }
    
    console.log("[FireSpreadLayer] Creating layers...");

    // Clean up old layers
    layersRef.current.forEach(layer => {
      if (globus.planet) {
        globus.planet.removeLayer(layer);
      }
    });
    layersRef.current = [];

    // Create layers for each time step
    predictions.forEach((predictionData, index) => {
      if (!predictionData.imageDataUrl || !predictionData.bbox) {
        console.warn(`[FireSpreadLayer] Frame ${index} missing imageDataUrl or bbox`);
        return;
      }

      const [minLon, minLat, maxLon, maxLat] = predictionData.bbox;
      
      console.log(`[FireSpreadLayer] Creating layer for hour ${predictionData.hour}, bbox:`, predictionData.bbox);

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
      console.log(`[FireSpreadLayer] Layer ${index} added, visible: ${index === currentFrame}`);
    });
    
    console.log(`[FireSpreadLayer] Total layers created: ${layersRef.current.length}`);

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
