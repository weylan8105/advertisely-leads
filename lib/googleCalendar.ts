// Per-user Google Calendar sync. Uses the app's Google OAuth client
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, already set for sign-in) plus an
// opt-in offline authorization with the calendar.events scope, so the CRM can
// create/update/delete a calendar event when an agent sets a callback reminder.
//
// Requires (one-time, in Google Cloud Console): the Calendar API enabled, the
// `.../auth/calendar.events` scope on the OAuth consent screen, and this app's
// redirect URI (see calendarRedirectUri) added to the OAuth client. Inert until
// configured AND the user connects their calendar.

import { prisma } from "./prisma";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE = process.env.NEXTAUTH_URL;

const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export function isCalendarConfigured(): boolean {
  return !!CLIENT_ID && !!CLIENT_SECRET && !!BASE;
}

export function calendarRedirectUri(): string {
  return `${(BASE ?? "").replace(/\/$/, "")}/api/integrations/google-calendar/callback`;
}

export function buildConsentUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID ?? "",
    redirect_uri: calendarRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force a refresh_token every time
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}> {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID ?? "",
    client_secret: CLIENT_SECRET ?? "",
    redirect_uri: calendarRedirectUri(),
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: CLIENT_ID ?? "",
    client_secret: CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token refresh failed: ${r.status}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

/** Best-effort decode of the id_token payload to show which account connected. */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** The caller's stored refresh token, or null if they haven't connected. */
export async function getCalendarRefreshToken(userId: string): Promise<string | null> {
  if (!prisma) return null;
  const integ = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: "GOOGLE_CALENDAR" } },
  });
  const cfg = (integ?.config ?? {}) as { refreshToken?: string };
  return integ?.enabled && cfg.refreshToken ? cfg.refreshToken : null;
}

interface EventInput { summary: string; description?: string; startISO: string; endISO: string }

function eventBody(ev: EventInput) {
  return {
    summary: ev.summary,
    description: ev.description,
    start: { dateTime: ev.startISO },
    end: { dateTime: ev.endISO },
    reminders: { useDefault: true },
  };
}

async function createEvent(accessToken: string, ev: EventInput): Promise<string> {
  const r = await fetch(EVENTS_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(ev)),
  });
  if (!r.ok) throw new Error(`create event failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { id: string };
  return j.id;
}

async function updateEvent(accessToken: string, eventId: string, ev: EventInput): Promise<void> {
  const r = await fetch(`${EVENTS_API}/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(ev)),
  });
  if (!r.ok) throw new Error(`update event failed: ${r.status}`);
}

async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  const r = await fetch(`${EVENTS_API}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404/410 = already gone; treat as success.
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`delete event failed: ${r.status}`);
}

/**
 * Reconcile a lead's callback with the caller's Google Calendar. Best-effort —
 * callers wrap this and never fail the callback save on a calendar error.
 * Returns the (possibly new/cleared) event id to persist on the lead.
 */
export async function syncCallbackEvent(opts: {
  userId: string;
  leadName: string;
  leadId: string;
  callbackAt: Date | null;
  existingEventId: string | null;
}): Promise<{ eventId: string | null } | null> {
  if (!isCalendarConfigured()) return null;
  const refresh = await getCalendarRefreshToken(opts.userId);
  if (!refresh) return null;

  const token = await getAccessToken(refresh);

  if (opts.callbackAt) {
    const startISO = opts.callbackAt.toISOString();
    const endISO = new Date(opts.callbackAt.getTime() + 30 * 60_000).toISOString();
    const ev: EventInput = {
      summary: `Call back: ${opts.leadName}`,
      description: "Callback reminder from your Advertisely CRM.",
      startISO,
      endISO,
    };
    if (opts.existingEventId) {
      try {
        await updateEvent(token, opts.existingEventId, ev);
        return { eventId: opts.existingEventId };
      } catch {
        // The event may have been deleted in Google — create a fresh one.
        return { eventId: await createEvent(token, ev) };
      }
    }
    return { eventId: await createEvent(token, ev) };
  }

  // Cleared: remove the event if we have one.
  if (opts.existingEventId) {
    await deleteEvent(token, opts.existingEventId);
  }
  return { eventId: null };
}
