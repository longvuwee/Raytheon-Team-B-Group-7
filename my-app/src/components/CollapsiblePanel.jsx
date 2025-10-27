import React, { useState } from "react";

export default function CollapsiblePanel({
  side = "left",
  title,
  defaultOpen = true,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isLeft = side === "left";

  const stop = (e) => {
    // prevent the globe canvas (or any parent) from capturing the event
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
      // ensure this layer accepts pointer events and doesn't bubble to the globe
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{ pointerEvents: "auto" }}
    >
      <button
        type="button"
        className={["panel-toggle", isLeft ? "left" : "right"].join(" ")}
        onMouseDown={stop}
        onPointerDown={stop}
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
        aria-label={open ? "Collapse panel" : "Expand panel"}
        title={open ? "Collapse" : "Expand"}
      >
        {isLeft ? (open ? "‹" : "›") : open ? "›" : "‹"}
      </button>

      <div className="panel">
        {title && <h3 className="panel-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
