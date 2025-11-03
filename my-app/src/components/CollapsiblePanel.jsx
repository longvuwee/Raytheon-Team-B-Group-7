import React, { useState } from "react";

export default function CollapsiblePanel({
  side = "left",
  title,
  defaultOpen = true,
  offsetLeft = 0,     //width of the sidebar in px
  behindSidebar = false, //keep panel behind, but move toggle to sidebar edge
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isLeft = side === "left";

  const arrow = isLeft ? (open ? "‹" : "›") : open ? "›" : "‹";

  // stop events from leaking to the globe canvas underneath
  const stop = (e) => {
    e.stopPropagation();
  };

  // Positioning:
  // - beside: shift the whole panel over by offsetLeft (+ margin)
  // - behind: keep panel where it was, but slide the toggle to the sidebar edge
  const baseGap = 12;
  const containerLeft = behindSidebar
    ? baseGap
    : baseGap + (isLeft ? offsetLeft : 0);

  // Move the pill toggle horizontally when we're behind the sidebar
  const pillTranslateX =
    behindSidebar && isLeft ? offsetLeft : 0;

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
      style={{
        pointerEvents: "auto",
        ...(isLeft ? { left: `${containerLeft}px` } : {}),
        zIndex: behindSidebar ? 1000 : 1001
      }}
    >
      {/*Toggle button */}
      <button
        type="button"
        className={["pill-toggle", isLeft ? "left" : "right"].join(" ")}
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
        aria-label={open ? "Collapse panel" : "Expand panel"}
        title={open ? "Collapse" : "Expand"}
        style={isLeft ? { transform: `translateX(${pillTranslateX}px)` } : undefined}
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
