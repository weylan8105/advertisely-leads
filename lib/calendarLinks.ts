// Build an "Add to Google Calendar" link — no OAuth required. Clicking it opens
// Google Calendar's event composer prefilled with the callback details, and the
// user saves it with one tap. This is the zero-setup path: it works for anyone
// with a Google account, with nothing to configure. (When an agent has connected
// their calendar for automatic sync, the server inserts the event directly and
// this link isn't needed.)

/** Google's TEMPLATE link wants UTC basic format: YYYYMMDDTHHMMSSZ. */
function fmtUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarEventUrl(opts: {
  title: string;
  start: Date;
  /** Defaults to 30 minutes after start (matches the auto-sync event length). */
  end?: Date;
  details?: string;
  location?: string;
}): string {
  const end = opts.end ?? new Date(opts.start.getTime() + 30 * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${fmtUtc(opts.start)}/${fmtUtc(end)}`,
  });
  if (opts.details) params.set("details", opts.details);
  if (opts.location) params.set("location", opts.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
