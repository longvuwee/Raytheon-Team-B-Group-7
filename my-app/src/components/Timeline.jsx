import { fmtDateTime, fmtTZShort } from "../utils/date";

export default function Timeline({ tz, now, end, sliderIdx, setSliderIdx, selectedDate, maxHours = 24 }) {
  return (
    <div className="timeline">
      <span className="timeline-label">{fmtDateTime(now, tz)}</span>
      <input type="range" min={0} max={maxHours} step={1} value={sliderIdx}
             onChange={e=>setSliderIdx(Number(e.target.value))} className="timeline-range" />
      <span className="timeline-label">{fmtDateTime(end, tz)}</span>
      <div className="timeline-current" title={selectedDate.toISOString()}>
        {fmtDateTime(selectedDate, tz)} {fmtTZShort(selectedDate, tz)}
      </div>
    </div>
  );
}
