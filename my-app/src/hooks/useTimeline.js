import { useMemo, useState } from "react";
const HOUR_MS = 3600_000;

export default function useTimeline(
  tz = "America/Chicago",
  startDate,
  endDate
) {
  const now = useMemo(() => {
    if (startDate) return new Date(startDate);
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }, [startDate]);

  const end = useMemo(() => {
    if (endDate) return new Date(endDate);
    return new Date(now.getTime() + 24 * HOUR_MS);
  }, [now, endDate]);

  const maxHours = useMemo(() => {
    return Math.ceil((end.getTime() - now.getTime()) / HOUR_MS);
  }, [now, end]);

  const [sliderIdx, setSliderIdx] = useState(0);
  const selectedDate = useMemo(
    () => new Date(now.getTime() + sliderIdx * HOUR_MS),
    [now, sliderIdx]
  );

  return { tz, now, end, sliderIdx, setSliderIdx, selectedDate, maxHours };
}
