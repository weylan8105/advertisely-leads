// Dials: an agent reaching for a lead's phone. There's no dialer to ask, so each of
// these stands in for a call, logged as a CALL_MADE lead activity with metadata
// {via, actorId}:
//
//   copy      copied the lead's number
//   call      tapped Call
//   talking   clicked the lead, which puts "Talking to" on it
//
// Moving a card or setting a callback also sets "Talking to", but those happen
// after the call, so they aren't dials. Copying an email isn't one either.

export const DIAL_VIAS = ["copy", "call", "talking"] as const;
export type DialVia = (typeof DIAL_VIAS)[number];

// Copying the number (or tapping Call) again is a redial and counts, up to
// DIAL_CAP dials per lead in any DIAL_CAP_MS. Copying it a third time inside
// that window doesn't add one.
export const DIAL_CAP = 2;
export const DIAL_CAP_MS = 2 * 60_000;
// Matches how long "Talking to" lasts (STALE_MS in /api/presence): clicking the
// lead again inside this window is the same call.
export const SAME_CALL_MS = 30 * 60_000;

export type DialAction = "log" | "skip" | "merge";

/**
 * What to do with a dial, given this agent's latest dials on this lead within
 * SAME_CALL_MS, newest first (DIAL_CAP of them is enough). Clicking a lead and
 * then copying its number is one call, so the copy takes over the click
 * ("merge") and only the next copy counts as a redial.
 */
export function dialAction(via: DialVia, recent: { via: unknown; at: Date }[], now: Date): DialAction {
  const latest = recent[0];
  if (!latest) return "log";
  if (via === "talking") return "skip";
  if (latest.via === "talking") return "merge";
  const inWindow = recent.filter((d) => now.getTime() - d.at.getTime() < DIAL_CAP_MS).length;
  return inWindow < DIAL_CAP ? "log" : "skip";
}

// One request at a time per lead, so the server has seen each dial before it
// decides on the next. Otherwise a click and a copy, or two quick copies, can
// race past each other and both count.
const inFlight = new Map<string, Promise<unknown>>();

/** Browser side: report a dial. Never blocks the agent. */
export function reportDial(leadId: string, via: DialVia) {
  const next = (inFlight.get(leadId) ?? Promise.resolve())
    .then(() =>
      fetch(`/api/leads/${leadId}/dial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ via }),
        keepalive: true,
      }),
    )
    .catch(() => {});
  inFlight.set(leadId, next);
  next.then(() => {
    if (inFlight.get(leadId) === next) inFlight.delete(leadId);
  });
}
