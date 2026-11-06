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

// Copying again sooner than this is a double click, not a redial.
export const REDIAL_MS = 30_000;
// Matches how long "Talking to" lasts (STALE_MS in /api/presence): clicking the
// lead again inside this window is the same call.
export const SAME_CALL_MS = 30 * 60_000;

export type DialAction = "log" | "skip" | "merge";

/**
 * What to do with a dial, given this agent's latest one on this lead within
 * SAME_CALL_MS. Clicking a lead and then copying its number is one call, so the
 * copy takes over the click ("merge") and only the next copy counts as a redial.
 */
export function dialAction(via: DialVia, recent: { via: unknown; at: Date } | null, now: Date): DialAction {
  if (!recent) return "log";
  if (via === "talking") return "skip";
  if (recent.via === "talking") return "merge";
  return now.getTime() - recent.at.getTime() < REDIAL_MS ? "skip" : "log";
}

// One click can reach here twice, so the first one wins.
const SAME_CLICK_MS = 2_000;
const sentAt = new Map<string, number>();

/** Browser side: report a dial. Never blocks the agent. */
export function reportDial(leadId: string, via: DialVia) {
  const now = Date.now();
  if (now - (sentAt.get(leadId) ?? 0) < SAME_CLICK_MS) return;
  sentAt.set(leadId, now);
  fetch(`/api/leads/${leadId}/dial`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ via }),
    keepalive: true,
  }).catch(() => {});
}
