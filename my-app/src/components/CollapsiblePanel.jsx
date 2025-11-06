import React, { useState } from "react";

export default function CollapsiblePanel({
  side = "left",
  title,
  defaultOpen = true,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isLeft = side === "left";

  // decide arrow direction so it points toward the map when open
  // and points back toward the panel when closed
  const arrow = isLeft
    ? open ? "‹" : "›"
    : open ? "›" : "‹";

  // stop events from leaking to the globe canvas underneath
  const stop = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      className={[
        "collapsible",
        open ? "open" : "collapsed",
        isLeft ? "left" : "right",
      ].join(" ")}
      aria-expanded={open}
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{ pointerEvents: "auto" }}
    >
      {/* floating pill toggle button */}
      <button
        type="button"
        className={["pill-toggle", isLeft ? "left" : "right"].join(" ")}
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
        aria-label={open ? "Collapse panel" : "Expand panel"}
        title={open ? "Collapse" : "Expand"}
      >
        {arrow}
      </button>

      <div className="panel">
        {title && <h3 className="panel-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
