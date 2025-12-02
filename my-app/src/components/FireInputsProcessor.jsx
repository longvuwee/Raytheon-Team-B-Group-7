import React, { useState } from 'react';
import { fetchUnprocessedFireInputs } from '../api/fireInputsApi';
import { processFireInputsBatch, fetchUnprocessedCount } from '../api/processFireInputsBatch';

export default function FireInputsProcessor() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lastRun, setLastRun] = useState(null);
  const [error, setError] = useState(null);
  const [pendingCount, setPendingCount] = useState(null);

  const refreshCount = async () => {
    const count = await fetchUnprocessedCount();
    setPendingCount(count);
  };

  React.useEffect(() => {
    refreshCount();
  }, []);

  const handleProcess = async () => {
    setError(null);
    setLoading(true);
    try {
      const rows = await fetchUnprocessedFireInputs(200); // initial batch size
      if (!rows.length) {
        setProgress({ done: 0, total: 0 });
        setLastRun('No unprocessed rows found');
        setLoading(false);
        refreshCount();
        return;
      }
      setProgress({ done: 0, total: rows.length });
      await processFireInputsBatch(rows, {
        concurrency: 8,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setLastRun(`Processed ${rows.length} rows`);
      refreshCount();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      background: 'rgba(0,0,0,0.6)',
      padding: '12px 16px',
      borderRadius: 8,
      fontSize: 14,
      color: '#fff',
      zIndex: 10000,
      maxWidth: 260
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>fire_inputs Batch</div>
      <div style={{ marginBottom: 6 }}>
        Pending: {pendingCount === null ? '…' : pendingCount}
      </div>
      {progress.total > 0 && (
        <div style={{ marginBottom: 6 }}>
          Progress: {progress.done} / {progress.total} ({progress.total ? ((progress.done / progress.total) * 100).toFixed(0) : 0}%)
        </div>
      )}
      {lastRun && <div style={{ marginBottom: 6 }}>Last: {lastRun}</div>}
      {error && <div style={{ color: '#ff7373', marginBottom: 6 }}>Error: {error}</div>}
      <button
        onClick={handleProcess}
        disabled={loading}
        style={{
          width: '100%',
          padding: '8px 10px',
          background: loading ? '#555' : '#ff5c1a',
          border: 'none',
          color: '#fff',
          cursor: loading ? 'default' : 'pointer',
          fontWeight: 600,
          borderRadius: 4
        }}
      >
        {loading ? 'Processing…' : 'Process 200 Rows'}
      </button>
      <button
        onClick={refreshCount}
        disabled={loading}
        style={{
          width: '100%',
          marginTop: 6,
          padding: '6px 10px',
          background: '#333',
          border: 'none',
          color: '#fff',
          cursor: loading ? 'default' : 'pointer',
          borderRadius: 4
        }}
      >
        Refresh Count
      </button>
    </div>
  );
}
