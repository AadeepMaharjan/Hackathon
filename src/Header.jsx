export function Header({ tab, onTabChange }) {
  return <div className="topbar"><div className="brand"><span className="mark" /><span className="name">Meridian Triage</span><span className="tag">bed &amp; resource allocation</span></div><nav className="tabs"><button className={tab === "intake" ? "active" : ""} onClick={() => onTabChange("intake")}>Intake</button><button className={tab === "dashboard" ? "active" : ""} onClick={() => onTabChange("dashboard")}>Dashboard</button></nav></div>;
}
