import { Link, useLocation } from "react-router-dom";
import Logo from "./Logo";

const SECTIONS = [
  { title: "Map", path: "/", isHome: true },
  { title: "Creators", path: "/creators" },
  { title: "API",      path: "/api" },
  { title: "Sources",  path: "/sources" },
  { title: "Docs",     path: "/docs" },
];

export default function Header() {
  const location = useLocation();

  // Separate Map from other navigation items
  const mapSection = SECTIONS.find(section => section.isHome);
  const otherSections = SECTIONS.filter(section => !section.isHome);

  return (
    <header className="site-header" role="banner">
      {/* Left: Logo + Title */}
      <div className="header-left">
        <Link className="header-brand" to="/">
          <Logo className="header-logo" />
          <span className="header-title">FireCastX</span>
        </Link>
      </div>

      {/* Center: Map button */}
      <div className="header-center">
        <Link 
          className={`header-link ${location.pathname === mapSection.path ? 'active' : ''} home-link`}
          to={mapSection.path}
        >
          <span className="home-icon">🌍</span>
          {mapSection.title}
        </Link>
      </div>

      {/* Right: Other navigation links */}
      <nav className="header-nav" role="navigation" aria-label="Primary">
        {otherSections.map((section) => (
          <Link 
            key={section.title} 
            className={`header-link ${location.pathname === section.path ? 'active' : ''}`}
            to={section.path}
          >
            {section.title}
          </Link>
        ))}
      </nav>
    </header>
  );
}