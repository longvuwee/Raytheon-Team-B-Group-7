import React from "react";

/**
 * LoadingOverlay - Displays a blurred overlay with progress updates during simulation
 */
function LoadingOverlay({ progress, message }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "rgba(255, 255, 255, 0.1)",
          padding: "40px 60px",
          borderRadius: "16px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          textAlign: "center",
          maxWidth: "500px",
        }}
      >
        {/* Spinner */}
        <div
          style={{
            width: "60px",
            height: "60px",
            border: "4px solid rgba(255, 255, 255, 0.3)",
            borderTop: "4px solid #fff",
            borderRadius: "50%",
            margin: "0 auto 24px",
            animation: "spin 1s linear infinite",
          }}
        />

        {/* Message */}
        <div
          style={{
            fontSize: "20px",
            fontWeight: "600",
            marginBottom: "16px",
            color: "#fff",
          }}
        >
          {message || "Processing..."}
        </div>

        {/* Progress bar */}
        {progress !== undefined && progress !== null && (
          <div style={{ width: "100%" }}>
            <div
              style={{
                width: "100%",
                height: "8px",
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                borderRadius: "4px",
                overflow: "hidden",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, progress))}%`,
                  height: "100%",
                  backgroundColor: "#4ade80",
                  transition: "width 0.3s ease",
                  borderRadius: "4px",
                }}
              />
            </div>
            <div
              style={{
                fontSize: "14px",
                color: "rgba(255, 255, 255, 0.8)",
                fontWeight: "500",
              }}
            >
              {Math.round(progress)}% complete
            </div>
          </div>
        )}
      </div>

      {/* CSS animation for spinner */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
}

export default LoadingOverlay;
