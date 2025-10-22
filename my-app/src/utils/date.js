export const fmtDateTime = (d, tz="America/Chicago") =>
  new Intl.DateTimeFormat("en-US",{ timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(d);

export const fmtTZShort = (d, tz="America/Chicago") =>
  new Intl.DateTimeFormat("en-US",{ timeZone: tz, timeZoneName:"short"})
    .formatToParts(d).find(p=>p.type==="timeZoneName")?.value || "CT";
