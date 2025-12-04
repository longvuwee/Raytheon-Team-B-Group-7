import { supabase } from '../supabaseClient';

// Shape matches server table columns (subset used by model)
export async function fetchUnprocessedFireInputs(limit = 100) {
  const { data, error } = await supabase
    .from('fire_inputs')
    .select('*')
    .eq('processed', false)
    .limit(limit);
  if (error) {
    console.error('[fireInputsApi] fetch error:', error);
    return [];
  }
  return data || [];
}

// Fetch recent fire_inputs rows to use as initial state/seed
export async function fetchRecentFireInputs(limit = 200) {
  const { data, error } = await supabase
    .from('fire_inputs')
    .select(
      `id, input_id, model, latitude, longitude, brightness, bright_t31, confidence, daynight,
       elevation, slope, aspect, temp, humidity, wind_speed, precip, month, processed, processed_at,
       block_id, block_row, block_col`
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Fetch the nearest fire_inputs row to a given lat/lon within a bounding box.
// Falls back to the most recent row if none found in the box.
export async function fetchNearestFireInput(lat, lon, { marginDeg = 0.25, limit = 200 } = {}) {
  const latMin = Number(lat) - marginDeg;
  const latMax = Number(lat) + marginDeg;
  const lonMin = Number(lon) - marginDeg;
  const lonMax = Number(lon) + marginDeg;

  // Try to filter by bounding box and take the most recent N, then pick nearest in JS
  const { data, error } = await supabase
    .from('fire_inputs')
    .select(
      `id, input_id, model, latitude, longitude, brightness, bright_t31, confidence, daynight,
       elevation, slope, aspect, temp, humidity, wind_speed, precip, month, processed, processed_at,
       block_id, block_row, block_col, created_at`
    )
    .gte('latitude', latMin)
    .lte('latitude', latMax)
    .gte('longitude', lonMin)
    .lte('longitude', lonMax)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[fireInputsApi] fetchNearestFireInput bbox query failed, falling back:', error);
    // Fallback to most recent if bbox query fails
    const recent = await fetchRecentFireInputs(1);
    return recent?.[0] || null;
  }

  const rows = data || [];
  if (rows.length === 0) {
    const recent = await fetchRecentFireInputs(1);
    return recent?.[0] || null;
  }

  // Choose nearest by squared distance
  let best = rows[0];
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    const d2 = (Number(r.latitude) - lat) ** 2 + (Number(r.longitude) - lon) ** 2;
    if (d2 < bestD2) {
      best = r;
      bestD2 = d2;
    }
  }
  return best;
}

export async function markProcessed(row, status = 'ok', responseObj = null) {
  const updates = {
    processed: true,
    processed_at: new Date().toISOString(),
    last_status: status,
    last_response: responseObj,
  };
  const hasInputId = row && row.input_id;
  if (hasInputId) {
    const { error } = await supabase
      .from('fire_inputs')
      .update(updates)
      .eq('input_id', row.input_id);
    if (!error) return;
    // If input_id path fails (schema mismatch) fall back to numeric id
    if (error.code !== '42703') {
      console.warn('[fireInputsApi] markProcessed input_id update failed, code', error.code);
    }
  }
  // Fallback to primary key id
  if (row && row.id !== undefined) {
    const { error: fallbackErr } = await supabase
      .from('fire_inputs')
      .update(updates)
      .eq('id', row.id);
    if (fallbackErr) {
      console.error('[fireInputsApi] markProcessed id fallback failed:', fallbackErr);
    }
  } else {
    console.error('[fireInputsApi] markProcessed called without usable identifiers');
  }
}

export function buildPredictBody(row, model = 'random_forest') {
  const safe = (v) => (v === undefined || v === null ? 0 : v);
  return {
    model,
    input_id: row.input_id || String(row.id), // normalise to string for server
    latitude: safe(row.latitude),
    longitude: safe(row.longitude),
    brightness: safe(row.brightness),
    bright_t31: safe(row.bright_t31),
    confidence: safe(row.confidence),
    daynight: safe(row.daynight),
    elevation: safe(row.elevation),
    slope: safe(row.slope),
    aspect: safe(row.aspect),
    temp: safe(row.temp),
    humidity: safe(row.humidity),
    wind_speed: safe(row.wind_speed),
    precip: safe(row.precip),
    month: safe(row.month),
  };
}

export async function fetchUnprocessedInputs(limit = 200) {
  const { data, error } = await supabase
    .from("fire_inputs")
    .select("*")
    .eq("processed", false)
    .limit(limit);

  if (error) {
    console.error("Error fetching fire_inputs:", error);
    return [];
  }
  return data ?? [];
}
