export default function BaseSwitch({ value, onChange }) {
  return (
    <div className="base-switch">
      <button onClick={()=>onChange("OSM")} disabled={value==="OSM"} className={`btn ${value==="OSM"?"btn-disabled":""}`}>OSM</button>
      <button onClick={()=>onChange("SAT")} disabled={value==="SAT"} className={`btn ${value==="SAT"?"btn-disabled":""}`}>SAT</button>
    </div>
  );
}
