import Logo from "./Logo";

const SECTIONS = [
<<<<<<< HEAD
  { title: "Map", href: "#/" },
  { title: "Creators", href: "#/creators" },
  { title: "API", href: "#/api" },
  { title: "Docs", href: "#/docs" },
];

export default function Header({ currentView, globeRef, SearchBar, onLocationSelect }) {
=======
  { title: "Creators", href: "#/creators" },
  { title: "API", href: "#/api" },
  { title: "Sources", href: "#/sources" },
  { title: "Docs", href: "#/docs" },
];

export default function Header() {
>>>>>>> e0d14416949a38f37369c54972b3bd6180ce24c8
  return (
    <header className="site-header" role="banner">
      {/* Left: Logo + Title */}
      <div className="header-left">
        <a className="header-brand" href="#/">
          <Logo className="header-logo" />
          <span className="header-title">FireCastX</span>
        </a>
      </div>

<<<<<<< HEAD
      {/* Center: Search Bar (only on map page) */}
      {currentView === 'map' && SearchBar && (
        <div className="header-center">
          <SearchBar 
            globeRef={globeRef}
            onLocationSelect={onLocationSelect}
          />
        </div>
      )}
=======
      {/* Center: Map button */}
      <div className="header-center">
        <a className="map-button" href="#/">
          <span className="map-icon">🌍</span>
          <span>Map</span>
        </a>
      </div>
>>>>>>> e0d14416949a38f37369c54972b3bd6180ce24c8

      {/* Right: Navigation links */}
      <nav className="header-nav" role="navigation" aria-label="Primary">
        {SECTIONS.map((s) => (
<<<<<<< HEAD
          <a 
            key={s.title} 
            className={`header-link ${s.title === 'Map' ? 'header-link-bold' : ''}`} 
            href={s.href}
          >
=======
          <a key={s.title} className="header-link" href={s.href}>
>>>>>>> e0d14416949a38f37369c54972b3bd6180ce24c8
            {s.title}
          </a>
        ))}
      </nav>
    </header>
  );
}