import { buildPredictBody, markProcessed } from './fireInputsApi';
import { supabase } from '../supabaseClient';

const RAW_API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || 'http://localhost:10000';
const API_BASE_URL = String(RAW_API_URL).replace(/\/+$/, '');

async function requestPredict(body) {
  const url = `${API_BASE_URL}/predict`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  } catch (e) {
    return { ok: false, json: { error: e.message } };
  }
}

export async function processFireInputsBatch(rows, {
  concurrency = 5,
  model = 'random_forest',
  onProgress,
} = {}) {
  const queue = [...rows];
  let done = 0;

  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      if (!row) break;
      const body = buildPredictBody(row, model);
      // Debug log for tracing individual prediction bodies
      console.debug('[batch] predict body', body);
      const { ok, json } = await requestPredict(body);
      if (!ok) {
        console.warn('[batch] predict error', json);
      }
      if (ok) {
        await markProcessed(row, 'ok', json);
      } else {
        await markProcessed(row, 'error', json);
      }
      done += 1;
      if (onProgress) onProgress(done, rows.length);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

export async function fetchUnprocessedCount() {
  const { count, error } = await supabase
    .from('fire_inputs')
    .select('*', { count: 'exact', head: true })
    .eq('processed', false);
  if (error) {
    console.error('[processFireInputsBatch] count error:', error);
    return 0;
  }
  return count || 0;
}