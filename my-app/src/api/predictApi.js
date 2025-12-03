// src/api/predictApi.js
// removed unused fetchUnprocessedInputs import

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "https://firecast-x.onrender.com";

export async function callPredict(body) {
  const res = await fetch(`${BACKEND_URL}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

function buildPredictBody(row) {
  return {
    model: "random_forest", // change later if you want LR or NN
    input_id: row.id,       // backend uses this to mark fire_inputs.processed
    latitude: row.latitude,
    longitude: row.longitude,
    brightness: row.brightness,
    bright_t31: row.bright_t31,
    confidence: row.confidence,
    daynight: row.daynight,
    elevation: row.elevation,
    slope: row.slope,
    aspect: row.aspect,
    temp: row.temp,
    humidity: row.humidity,
    wind_speed: row.wind_speed,
    precip: row.precip,
    month: row.month,
  };
}

/**
 * Run the model on the next N unprocessed rows from fire_inputs.
 * Uses basic concurrency so we don't hammer the backend.
 */
export async function processInputsBatch(
  rows,
  concurrency = 5,
  onProgress
) {
  const queue = [...rows];
  let processed = 0;

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) break;

      const body = buildPredictBody(row);
      try {
        const { ok, json } = await callPredict(body);
        if (!ok) {
          console.error("Predict error for id", row.id, json);
        } else {
          // Optional: do something with json.instant_spread_probability
          // console.log("Processed id", row.id, json.instant_spread_probability);
        }
      } catch (e) {
        console.error("Network error for id", row.id, e);
      }

      processed += 1;
      if (onProgress) onProgress(processed, rows.length);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);
}
