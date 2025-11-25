import Logo from "./Logo";

const SECTIONS = [
  { title: "Map", href: "#/" },
  { title: "Creators", href: "#/creators" },
  { title: "API", href: "#/api" },
  { title: "Docs", href: "#/docs" },
];

export default function Header({ currentView, globeRef, SearchBar, onLocationSelect }) {
  return (
    <header className="site-header" role="banner">
      {/* Left: Logo + Title */}
      <div className="header-left">
        <a className="header-brand" href="#/">
          <Logo className="header-logo" />
          <span className="header-title">FireCastX</span>
        </a>
      </div>

      {/* Center: Search Bar (only on map page) */}
      {currentView === 'map' && SearchBar && (
        <div className="header-center">
          <SearchBar 
            globeRef={globeRef}
            onLocationSelect={onLocationSelect}
          />
        </div>
      )}

      {/* Right: Navigation links */}
      <nav className="header-nav" role="navigation" aria-label="Primary">
        {SECTIONS.map((s) => (
          <a 
            key={s.title} 
            className={`header-link ${s.title === 'Map' ? 'header-link-bold' : ''}`} 
            href={s.href}
          >
            {s.title}
          </a>
        ))}
      </nav>
    </header>
  );
}