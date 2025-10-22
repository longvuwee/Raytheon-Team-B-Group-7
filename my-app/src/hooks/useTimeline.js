import { useMemo, useState } from "react";
const HOUR_MS = 3600_000;

export default function useTimeline(tz="America/Chicago") {
  const now = useMemo(() => { const d = new Date(); d.setMinutes(0,0,0); return d; }, []);
  const end = useMemo(() => new Date(now.getTime() + 24 * HOUR_MS), [now]);
  const [sliderIdx, setSliderIdx] = useState(0);
  const selectedDate = useMemo(() => new Date(now.getTime() + sliderIdx * HOUR_MS), [now, sliderIdx]);
  return { tz, now, end, sliderIdx, setSliderIdx, selectedDate };
}
