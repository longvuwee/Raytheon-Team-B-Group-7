export default function IntroOverlay({ show, onClose, Logo }) {
  if (!show) return null;
  return (
    <div className="intro" onClick={onClose}>
      <div className="intro-card" onClick={e=>e.stopPropagation()}>
        {Logo}
        <h1 className="intro-title">Fire CastX</h1>
        <p className="intro-subtitle">Fires around the U.S in one place.</p>
        <div className="intro-cta">Click anywhere to continue</div>
      </div>
    </div>
  );
}
