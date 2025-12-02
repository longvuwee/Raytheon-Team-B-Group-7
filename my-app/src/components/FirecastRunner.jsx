// src/components/FirecastRunner.jsx
import React, { useEffect, useRef, useState } from "react";
import { fetchUnprocessedInputs } from "../api/fireInputsApi";
import { processInputsBatch } from "../api/predictApi";
import { fetchBlocks } from "../api/blocksApi";
import { createFireGlobe, renderBlocksOnLayer } from "../globe/fireGlobe";

export const FirecastRunner = () => {
  const globeContainerRef = useRef(null);
  const fireLayerRef = useRef(null);

  const [status, setStatus] = useState("idle"); // "idle" | "running" | "done" | "error"
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lastMessage, setLastMessage] = useState("");

  // Initialize globe once
  useEffect(() => {
    let disposed = false;

    async function initGlobe() {
      if (!globeContainerRef.current) return;
      try {
        const { fireLayer } = await createFireGlobe(globeContainerRef.current);
        if (disposed) return;
        fireLayerRef.current = fireLayer;
        await refreshHeatmap(); // draw initial data
      } catch (e) {
        console.error("Error initializing globe:", e);
      }
    }

    initGlobe();

    return () => {
      disposed = true;
      // If you want to clean up globe.planet, do it here.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshHeatmap() {
    if (!fireLayerRef.current) {
      setLastMessage("Globe not ready yet.");
      return;
    }
    const blocks = await fetchBlocks();
    renderBlocksOnLayer(fireLayerRef.current, blocks);
    setLastMessage(`Loaded ${blocks.length} blocks for heatmap.`);
  }

  async function runBatch() {
    try {
      setStatus("running");
      setLastMessage("Loading unprocessed inputs from Supabase...");
      setProgress({ done: 0, total: 0 });

      const inputs = await fetchUnprocessedInputs(200);
      if (inputs.length === 0) {
        setLastMessage("No unprocessed rows found in fire_inputs.");
        setStatus("idle");
        return;
      }

      setProgress({ done: 0, total: inputs.length });
      setLastMessage(`Processing ${inputs.length} rows through /predict...`);

      await processInputsBatch(inputs, 5, (done, total) => {
        setProgress({ done, total });
      });

      setStatus("done");
      setLastMessage("Batch processed. Refreshing heatmap from fire_blocks...");
      await refreshHeatmap();
    } catch (e) {
      console.error(e);
      setStatus("error");
      setLastMessage("Error during batch processing. See console for details.");
    }
  }

  const progressText =
    progress.total > 0 ? `${progress.done} / ${progress.total}` : "0 / 0";

  return (
    <div style={{ display: "flex", gap: "1rem", height: "100%" }}>
      {/* Left: controls */}
      <div
        style={{
          width: "280px",
          padding: "1rem",
          borderRight: "1px solid #ccc",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          background: "rgba(0,0,0,0.4)",
        }}
      >
        <h2>Firecast Controller</h2>

        <div>
          <strong>Status:</strong> {status}
        </div>
        <div>
          <strong>Progress:</strong> {progressText}
        </div>
        <div style={{ fontSize: "0.9rem", minHeight: "2em" }}>
          {lastMessage}
        </div>

        <button
          className="run-btn"
          type="button"
          onClick={runBatch}
          disabled={status === "running"}
        >
          Run Batch (200 rows max)
        </button>

        <button
          style={{
            marginTop: "0.5rem",
            width: "100%",
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            border: "1px solid #666",
            background: "rgba(30,30,30,0.9)",
            color: "#fff",
            fontWeight: 500,
            cursor: "pointer",
          }}
          type="button"
          onClick={refreshHeatmap}
        >
          Refresh Heatmap
        </button>
      </div>

      {/* Right: globe */}
      <div
        ref={globeContainerRef}
        style={{ flex: 1, position: "relative", overflow: "hidden" }}
      />
    </div>
  );
};
