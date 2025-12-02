/**
 * API client for fire spread prediction backend
 */

// Accept either VITE_API_URL or legacy VITE_BACKEND_URL and normalize (no trailing slash)
const RAW_API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const API_BASE_URL = String(RAW_API_URL).replace(/\/+$/, '');

async function requestWithLogging(url, options = {}) {
  try {
    console.log('[api] fetch ->', (options.method || 'GET').toUpperCase(), url);
    
    // Add 60 second timeout for long-running predictions
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      // attempt to read response body for diagnostics
      const text = await res.text().catch(() => '<no body>');
      console.error(`[api] fetch failed: ${res.status} ${res.statusText} -> ${url}`);
      console.error('[api] response body:', text);
      throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[api] Request timeout after 60 seconds:', url);
      throw new Error('Request timed out after 60 seconds');
    }
    console.error('[api] network/error fetching', url, err);
    throw err;
  }
}

/**
 * Generate fire spread predictions for a cluster of fire points
 * @param {Array} clusterPoints - Array of fire points with lat, lon, brightness, etc.
 * @param {number} forecastHours - Number of hours to forecast
 * @param {string} modelName - Model to use (neural_network, random_forest, logreg)
 * @returns {Promise<Array>} Array of predictions for each time step
 */
export async function generateSpreadForecast(clusterPoints, forecastHours = 24, modelName = "neural_network") {
  try {
    const url = `${API_BASE_URL}/predict-spread-animation`;
    const response = await requestWithLogging(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: clusterPoints, time_steps: forecastHours, model_name: modelName }),
    });

    const data = await response.json();
  // Return the full response so callers can access time_steps and other metadata
  return data;
  } catch (error) {
    console.error('Failed to generate forecast:', error);
    throw error;
  }
}

/**
 * Test the backend health endpoint. Returns the parsed JSON or throws.
 */
export async function testBackend() {
  const url = `${API_BASE_URL}/health`;
  const res = await requestWithLogging(url, { method: 'GET' });
  return await res.json();
}

/**
 * Run a single-point prediction against the backend `/predict` endpoint.
 * Expects the `row` to contain all required features and an `id` field.
 * The backend will pick up `input_id` and persist it to `fire_inputs`.
 */
export async function runPointPrediction(row, modelName = "random_forest") {
  try {
    const prepared = await preparePointInput(row);
    const body = {
      model: modelName,
      input_id: prepared.input_id,
      // include all feature keys expected by the server
      latitude: prepared.latitude,
      longitude: prepared.longitude,
      brightness: prepared.brightness,
      bright_t31: prepared.bright_t31,
      confidence: prepared.confidence,
      daynight: prepared.daynight,
      elevation: prepared.elevation,
      slope: prepared.slope,
      aspect: prepared.aspect,
      temp: prepared.temp,
      humidity: prepared.humidity,
      wind_speed: prepared.wind_speed,
      precip: prepared.precip,
      month: prepared.month,
    };

    const url = `${API_BASE_URL}/predict`;
    const res = await requestWithLogging(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || `Predict failed: ${res.status}`);
    }
    return json;
  } catch (err) {
    console.error('runPointPrediction error', err);
    throw err;
  }
}

/**
 * Fetch environmental data for a location (for prediction features)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Date} date - Date/time
 * @returns {Promise<Object>} Environmental data
 */
export async function fetchEnvironmentalData(lat, lon, date) {
  try {
    const url = `${API_BASE_URL}/environmental-data`;
    const response = await requestWithLogging(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude: lat, longitude: lon, datetime: date.toISOString() }) });
    return await response.json();
  } catch (error) {
    console.warn('Environmental data fetch failed, using defaults:', error);
    return getDefaultEnvironmentalData();
  }
}

function getDefaultEnvironmentalData() {
  return {
    temperature: 25,
    humidity: 40,
    wind_speed: 10,
    wind_direction: 180,
    vegetation_index: 0.3,
    elevation: 500,
    slope: 15,
  };
}

// Feature keys required by the backend model
export const FEATURE_KEYS = [
  "latitude",
  "longitude",
  "brightness",
  "bright_t31",
  "confidence",
  "daynight",
  "elevation",
  "slope",
  "aspect",
  "temp",
  "humidity",
  "wind_speed",
  "precip",
  "month",
];

/**
 * Prepare a full feature object from a raw `row`.
 * - Ensures `input_id` is present
 * - Fills missing environmental/topo fields via `fetchEnvironmentalData` or defaults
 * - Maps environmental keys to the names expected by the model (e.g., temperature -> temp)
 */
export async function preparePointInput(row) {
  if (!row) throw new Error('Missing row');

  // Ensure an id exists
  const inputId = row.id ?? `${Date.now()}-${row.latitude}-${row.longitude}`;

  // Attempt to derive month and day/night if not present
  let month = row.month;
  if (!month) {
    const t = row.time || row.timestamp || Date.now();
    month = new Date(t).getMonth() + 1;
  }

  let daynight = row.daynight;
  if (daynight === undefined || daynight === null) {
    // If timestamp hour is between 6 and 18 consider day (1), else night (0)
    const t = row.time || row.timestamp || Date.now();
    const h = new Date(t).getHours();
    daynight = (h >= 6 && h <= 18) ? 1 : 0;
  }

  // If environmental/topo fields missing, fetch them
  const needEnv = (
    row.temp === undefined || row.humidity === undefined || row.wind_speed === undefined || row.elevation === undefined || row.slope === undefined
  );

  let env = {};
  if (needEnv) {
    try {
      const fetched = await fetchEnvironmentalData(row.latitude, row.longitude, new Date());
      env = fetched || {};
    } catch (e) {
      env = getDefaultEnvironmentalData();
    }
  }

  // Map environmental keys to model names
  const temp = row.temp ?? env.temperature ?? env.temp ?? getDefaultEnvironmentalData().temperature;
  const humidity = row.humidity ?? env.humidity ?? getDefaultEnvironmentalData().humidity;
  const wind_speed = row.wind_speed ?? env.wind_speed ?? getDefaultEnvironmentalData().wind_speed;
  const elevation = row.elevation ?? env.elevation ?? getDefaultEnvironmentalData().elevation;
  const slope = row.slope ?? env.slope ?? getDefaultEnvironmentalData().slope;
  const aspect = row.aspect ?? 0;
  const precip = row.precip ?? 0;

  // Build final object matching backend FEATURE_KEYS
  const features = {
    input_id: inputId,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    brightness: Number(row.brightness ?? row.brt ?? 0),
    bright_t31: Number(row.bright_t31 ?? row.brt_t31 ?? 0),
    confidence: Number(row.confidence ?? row.conf ?? 0),
    daynight: Number(daynight),
    elevation: Number(elevation),
    slope: Number(slope),
    aspect: Number(aspect),
    temp: Number(temp),
    humidity: Number(humidity),
    wind_speed: Number(wind_speed),
    precip: Number(precip),
    month: Number(month),
  };

  return features;
}
