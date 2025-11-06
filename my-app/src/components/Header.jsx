import React from "react";
import Logo from "./Logo";

const SECTIONS = [
  { title: "Creators", href: "#/creators" },
  { title: "API",      href: "#/api" },
  { title: "Sources",  href: "#/sources" },
  { title: "Docs",     href: "#/docs" },
];

export default function Header() {
  return (
    <header className="site-header" role="banner">
      {/* Left: Logo + Title */}
      <div className="header-left">
        <a className="header-brand" href="#/">
          <Logo className="header-logo" />
          <span className="header-title">FireCastX</span>
        </a>
      </div>

      {/* Right: Navigation links */}
      <nav className="header-nav" role="navigation" aria-label="Primary">
        {SECTIONS.map((s) => (
          <a key={s.title} className="header-link" href={s.href}>
            {s.title}
          </a>
        ))}
      </nav>
    </header>
  );
}