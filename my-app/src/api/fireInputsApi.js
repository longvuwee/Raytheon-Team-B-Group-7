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
  if (error) {
    console.error('[fireInputsApi] fetchRecentFireInputs error:', error);
    throw new Error(`Supabase error: ${error.message || JSON.stringify(error)}`);
  }
  return data || [];
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
// Duplicate import removed; using unified root supabaseClient.

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
