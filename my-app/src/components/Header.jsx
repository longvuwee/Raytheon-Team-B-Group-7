import Logo from "./Logo";

const SECTIONS = [
  { title: "Map", href: "#/" },
  { title: "Creators", href: "#/creators" },
  { title: "Docs", href: "https://github.com/longvuwee/Raytheon-Team-B-Group-7", external: true },
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

  const handleLinkClick = (e, section) => {
    if (section.external) {
      e.preventDefault();
      e.stopPropagation();
      // Open in background tab by using a temporary link with download attribute trick
      const link = document.createElement('a');
      link.href = section.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      // Dispatch with middle mouse button simulation to open in background
      const evt = new MouseEvent('click', {
        ctrlKey: true,
        metaKey: true,
        button: 0,
        bubbles: true,
        cancelable: true
      });
      link.dispatchEvent(evt);
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
        {SECTIONS.map((s) => {
          // Determine if this link is active based on currentView
          const isActive = 
            (s.title === 'Map' && currentView === 'map') ||
            (s.title === 'Creators' && currentView === 'creators') ||
            (s.title === 'Docs' && currentView === 'docs');
          
          return (
            <a 
              key={s.title} 
              className={`header-link ${isActive ? 'header-link-bold' : ''}`} 
              href={s.href}
              onClick={(e) => handleLinkClick(e, s)}
              {...(s.external && { rel: "noopener noreferrer" })}
            >
              {s.title}
            </a>
          );
        })}
      </nav>
    </header>
  );
}