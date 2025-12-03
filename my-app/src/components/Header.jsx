import Logo from "./Logo";

const SECTIONS = [
  { title: "Map", href: "#/" },
  { title: "Creators", href: "#/creators" },
  { title: "API", href: "#/api" },
  { title: "Docs", href: "#/docs" },
];

export default function Header({ currentView, globeRef, SearchBar, onLocationSelect }) {
  const handleLogoClick = (e) => {
    e.preventDefault();
    if (globeRef?.current?.resetToInitialView) {
      globeRef.current.resetToInitialView();
    }
    // Also navigate to home if not already there
    if (window.location.hash !== '#/' && window.location.hash !== '') {
      window.location.hash = '#/';
    }
  };

  return (
    <header className="site-header" role="banner">
      {/* Left: Logo + Title */}
      <div className="header-left">
        <div className="header-brand" onClick={handleLogoClick} style={{ cursor: 'pointer' }}>
          <Logo className="header-logo" />
          <span className="header-title">FireCastX</span>
        </div>
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