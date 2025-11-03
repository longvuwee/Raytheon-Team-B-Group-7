import React from "react";
import Logo from "./Logo";

const SECTIONS = [
  { title: "Creators", href: "#/creators" },
  { title: "API",      href: "#/api" },
  { title: "Sources",  href: "#/sources" },
  { title: "Docs",     href: "#/docs" },
];

export default function Sidebar({ open, onToggle }) {
  const width = open ? 200 : 50;

  return (
    <aside
      className={`sidebar ${open ? "open" : "collapsed"}`}
      style={{ width }}
      aria-label="App sidebar"
    >
      {/* Header / Logo */}
      <div className="sidebar-top">
        <div className="logo-wrapper">
          <Logo className="sidebar-logo" />
          {open && <div className="sidebar-title">FireCastX</div>}
          <button
            className={`sidebar-toggle ${open ? "visible" : "hidden"}`}
            onClick={onToggle}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            title={open ? "Collapse" : "Expand"}
          >
            {open ? "«" : "»"}
          </button>
        </div>
      </div>

      {/* Nav sections */}
      <nav className="sidebar-nav" role="navigation">
        {SECTIONS.map((s) => (
          <a key={s.title} className="sidebar-link" href={s.href}>
            <span className="sidebar-link-dot" />
            {open ? s.title : <span className="sr-only">{s.title}</span>}
          </a>
        ))}
      </nav>

      {/* Footer mini text */}
      <div className="sidebar-footer">
        {open ? <small>v0.1 • Raytheon Team B</small> : null}
      </div>
    </aside>
  );
}