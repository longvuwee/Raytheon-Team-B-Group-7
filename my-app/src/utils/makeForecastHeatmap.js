/**
 * Generate prediction heatmap from fire spread forecast data
 * Similar to makeDensityHeatMap but for predictions
 */

export default function makeForecastHeatmap(predictions, width = 800, height = 600) {
  if (!predictions || predictions.length === 0) {
    return { imageDataUrl: null, bbox: null };
  }

  // Find bounding box
  const lats = predictions.map(p => p.lat);
  const lons = predictions.map(p => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  // Add padding (10%)
  const latPadding = (maxLat - minLat) * 0.1;
  const lonPadding = (maxLon - minLon) * 0.1;

  const bbox = [
    minLon - lonPadding,
    minLat - latPadding,
    maxLon + lonPadding,
    maxLat + latPadding
  ];

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fill transparent background
  ctx.clearRect(0, 0, width, height);

  // Map lat/lon to pixel coordinates
  const latRange = bbox[3] - bbox[1];
  const lonRange = bbox[2] - bbox[0];

  const toPixel = (lon, lat) => {
    const x = ((lon - bbox[0]) / lonRange) * width;
    const y = height - ((lat - bbox[1]) / latRange) * height;
    return [x, y];
  };

  // Draw prediction points with intensity based on spread probability
  predictions.forEach(pred => {
    const [x, y] = toPixel(pred.lon, pred.lat);
    const probability = pred.spread_probability || 0;

    // Gradient based on probability
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 40);
    
    // Color based on risk level
    let color;
    if (probability >= 0.75) {
      // High risk - red
      color = `rgba(255, 50, 50, ${probability})`;
    } else if (probability >= 0.50) {
      // Medium risk - orange
      color = `rgba(255, 150, 50, ${probability * 0.8})`;
    } else if (probability >= 0.25) {
      // Low risk - yellow
      color = `rgba(255, 200, 50, ${probability * 0.6})`;
    } else {
      // Very low risk - light yellow
      color = `rgba(255, 255, 100, ${probability * 0.4})`;
    }

    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(x - 40, y - 40, 80, 80);
  });

  // Apply blur for smooth heatmap effect
  ctx.filter = 'blur(8px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';

  const imageDataUrl = canvas.toDataURL('image/png');
  return { imageDataUrl, bbox };
}
