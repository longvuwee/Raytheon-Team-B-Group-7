export default function IntroOverlay({ show, onClose, Logo }) {
  if (!show) return null;
  
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="intro" onClick={handleOverlayClick}>
      <div className="intro-card" onClick={e=>e.stopPropagation()}>
        {Logo}
        <h1 className="intro-title">Fire CastX</h1>
        <p className="intro-subtitle">Fires around the U.S in one place.</p>
        <div className="intro-cta">Click anywhere outside this box to continue</div>
        <button 
          className="intro-close-btn"
          onClick={onClose}
          type="button"
        >
          Get Started →
        </button>
      </div>
    </div>
  );
}
