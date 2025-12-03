/**
 * API client for fire spread prediction backend
 */

// Accept either VITE_API_URL or legacy VITE_BACKEND_URL and normalize (no trailing slash)
const RAW_API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const API_BASE_URL = String(RAW_API_URL).replace(/\/+$/, '');
// Configurable timeout (defaults to 180s to avoid long-run aborts)
const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 180000);

async function requestWithLogging(url, options = {}) {
  try {
    const method = (options.method || 'GET').toUpperCase();
    const bodyPreview = options.body ? (() => {
      try { return typeof options.body === 'string' ? `${options.body.length}b` : '<non-string>'; } catch { return '<body>'; }
    })() : '';
    console.log('[api] fetch ->', method, url, bodyPreview ? `(body=${bodyPreview})` : '');

    // Add a timeout via AbortController to avoid indefinite waits
    const controller = new AbortController();
    const { timeoutMs, ...fetchOptions } = options;
    const ms = Number.isFinite(timeoutMs) ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    const id = setTimeout(() => controller.abort(), ms);
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) {
      // attempt to read response body for diagnostics
      const text = await res.text().catch(() => '<no body>');
      console.error(`[api] fetch failed: ${res.status} ${res.statusText} -> ${url}`);
      console.error('[api] response body:', text);
      throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    }
    return res;
  } catch (err) {
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
export async function generateSpreadForecast(clusterPoints, forecastHours = 24, modelName = "neural_network", spreadThreshold) {
  try {
    const url = `${API_BASE_URL}/predict-spread-animation`;
    const response = await requestWithLogging(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: clusterPoints, time_steps: forecastHours, model_name: modelName, ...(spreadThreshold !== undefined ? { spread_threshold: spreadThreshold } : {}) }),
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
 * Stream fire spread predictions using Server-Sent Events (SSE).
 * Never times out client-side; yields step events as they arrive.
 *
 * @param {Object} params
 * @param {Array} params.clusterPoints - Array of seed points
 * @param {number} params.forecastHours - Number of steps to simulate
 * @param {string} params.modelName - Model to use (random_forest|logreg|neural_network)
 * @param {number} [params.spreadThreshold]
 * @param {boolean} [params.fastMode]
 * @param {number} [params.maxCells]
 * @param {number} [params.maxCandidatesPerStep]
 * @param {(payload)=>void} [params.onStep] - Called with { time, predictions }
 * @param {(payload)=>void} [params.onLog]
 * @param {(payload)=>void} [params.onDone]
 * @param {(err)=>void} [params.onError]
 * @returns {EventSource} - Caller should keep and close when done.
 */
export function streamSpreadForecast({
  clusterPoints,
  forecastHours = 24,
  modelName = "logreg",
  spreadThreshold,
  fastMode = true,
  maxCells,
  maxCandidatesPerStep,
  onStep,
  onLog,
  onDone,
  onError,
}) {
  const params = new URLSearchParams();
  params.set("cluster", JSON.stringify(clusterPoints || []));
  params.set("time_steps", String(forecastHours));
  params.set("model_name", modelName);
  if (spreadThreshold !== undefined) params.set("spread_threshold", String(spreadThreshold));
  if (fastMode !== undefined) params.set("fast_mode", String(!!fastMode));
  if (maxCells !== undefined) params.set("max_cells", String(maxCells));
  if (maxCandidatesPerStep !== undefined) params.set("max_candidates_per_step", String(maxCandidatesPerStep));

  const url = `${API_BASE_URL}/predict-spread-stream?${params.toString()}`;
  console.log("[api:sse] opening:", url);
  const es = new EventSource(url);

  es.addEventListener("log", (e) => {
    try { const data = JSON.parse(e.data); onLog && onLog(data); }
    catch { onLog && onLog({ message: e.data }); }
  });
  es.addEventListener("step", (e) => {
    try { const data = JSON.parse(e.data); onStep && onStep(data); }
    catch (err) { console.warn("[api:sse] step parse error", err, e.data); }
  });
  es.addEventListener("done", (e) => {
    try { const data = JSON.parse(e.data); onDone && onDone(data); }
    catch { onDone && onDone({}); }
    es.close();
  });
  es.addEventListener("error", (e) => {
    console.warn("[api:sse] error", e);
    onError && onError(e);
  });
  return es;
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
    } catch {
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
