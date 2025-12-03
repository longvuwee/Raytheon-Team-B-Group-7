import FireCastLogo from "../assets/FireCast_LOGO.png";
export default function Logo({ className="app-logo", onClick }) {
  return <img src={FireCastLogo} alt="FireCast" className={className} draggable={false} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }} />;
}
