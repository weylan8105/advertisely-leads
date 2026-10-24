import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { normalizeInboundLead } from "@/lib/inboundLead";
import { createInboundLead } from "@/lib/inboundIntake";
import { allowHit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quiz/submit — keyless, same-origin lead intake for the ABCA quiz
 * (public/abca-quiz.html). Replaces the quiz posting to /api/webhooks/inbound
 * with a leads:write API key embedded in the page source.
 *
 * Anyone can call this, so it accepts only the quiz's own fields and layers
 * cheap abuse controls before a lead is created:
 *  - same-origin Origin check + JSON content type (stops other sites' pages
 *    from submitting through their visitors' browsers)
 *  - per-IP limits: a per-instance burst limit + a DB cap on quiz leads/IP/day
 *  - a hidden honeypot field (hp_check) the real page always sends empty
 *  - the payload's session_id must have a funnel 'view' and 'step' beacon
 *    (FunnelEvent) from at least MIN_FILL_MS earlier, and yields one lead max
 *  - the same phone can't create a second quiz lead inside the dedupe window
 * The lead is then created exactly like the inbound webhook (createInboundLead).
 * Responds 2xx only when the request was accepted — the page fires its
 * 'complete' beacon + pixel and redirects to /thank-you.html on 2xx.
 */

const SOURCE = "early-retirement-quiz";
const MAX_BODY_CHARS = 16_000;
const BURST_LIMIT = 10; // requests per IP per instance per window
const BURST_WINDOW_MS = 10 * 60_000;
const DAILY_LEADS_PER_IP = 3;
const DAY_MS = 24 * 60 * 60_000;
const SESSION_MAX_AGE_MS = 2 * DAY_MS; // also the session/phone dedupe window
const MIN_FILL_MS = 8_000; // fastest real lead observed: 35s after page view
const MAX_FIELD_LEN = 2_000;

// Only the quiz's own fields are stored; anything else (packageId, tags,
// customData, contact ids...) is dropped so this route can't steer routing.
const ALLOWED_FIELDS = new Set([
  "first_name", "last_name", "full_name", "name", "phone", "email", "state", "zip",
  "age", "intent", "source", "lead_source", "external_id",
  "quiz_beneficiary", "quiz_iul_interest", "quiz_age", "quiz_coverage", "quiz_lead_tier",
  "consent_given", "consent_timestamp", "consent_language", "consent_ip",
  "event_name", "event_id", "fbc", "fbp", "fbclid",
  "utm_source", "utm_campaign", "utm_content", "landing_url", "submitted_at",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_RE = /^s_[a-z0-9]{1,16}_[a-z0-9]{1,16}$/;
const EVENT_ID_RE = /^ev_\d{10,16}_[a-z0-9]{1,16}$/;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function reject(reason: string, ip: string, data: unknown, status: number) {
  console.warn(`[quiz/submit] rejected: ${reason} (ip ${ip})`);
  return json(data, status);
}

function str(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return json({ error: "Database not configured." }, 503);
  }
  const ip = clientIp(req.headers);

  // Browsers always send Origin on POST; a foreign one means another site's
  // page is posting through its visitors. (Non-browser callers hit the
  // session/rate checks below instead.)
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")];
    if (!originHost || !hosts.includes(originHost)) {
      return reject("cross-origin", ip, { error: "Forbidden" }, 403);
    }
  }

  if (!allowHit(`quiz:${ip}`, BURST_LIMIT, BURST_WINDOW_MS)) {
    return reject("burst limit", ip, { error: "Too many requests." }, 429);
  }

  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return json({ error: "Expected JSON." }, 415);
  }
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: "Payload too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  // Honeypot: rendered off-screen and always sent empty by the real page.
  // Missing or filled -> reject (a 2xx would make the page fire the pixel).
  if (body.hp_check !== "") {
    return reject("honeypot", ip, { error: "Invalid submission." }, 400);
  }

  const name = str(body.full_name) || str(body.name);
  let phoneDigits = str(body.phone).replace(/\D/g, "");
  if (phoneDigits.length === 11 && phoneDigits[0] === "1") phoneDigits = phoneDigits.slice(1);
  const email = str(body.email);
  const zip = str(body.zip);
  const sessionId = str(body.session_id);
  const eventId = str(body.event_id);

  const invalid: string[] = [];
  if (!name.includes(" ") || name.length > 100) invalid.push("name");
  if (!/^[2-9]\d{9}$/.test(phoneDigits)) invalid.push("phone");
  if (!EMAIL_RE.test(email) || email.length > 254) invalid.push("email");
  if (!/^\d{5}$/.test(zip)) invalid.push("zip");
  if (str(body.consent_given).toLowerCase() !== "yes") invalid.push("consent_given");
  if (!SESSION_RE.test(sessionId)) invalid.push("session_id");
  if (!EVENT_ID_RE.test(eventId)) invalid.push("event_id");
  if (invalid.length) {
    return reject(`invalid ${invalid.join(",")}`, ip, { error: "Invalid fields.", fields: invalid }, 400);
  }

  // The page beacons 'view' on load and 'step' as the quiz advances, under the
  // same sessionId. Real submissions always have both, well before submit.
  const now = Date.now();
  const events = await prisma.funnelEvent.findMany({
    where: { sessionId, createdAt: { gte: new Date(now - SESSION_MAX_AGE_MS) } },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const firstView = events.find((e) => e.type === "view");
  if (
    !firstView ||
    !events.some((e) => e.type === "step") ||
    now - firstView.createdAt.getTime() < MIN_FILL_MS
  ) {
    return reject("no funnel session", ip, { error: "Session not recognized. Please reload and try again." }, 403);
  }

  // One lead per session, and no repeat lead for the same phone. A real
  // double-submit gets a normal 2xx so the visitor still reaches thank-you.
  const phone = `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
  const dup = await prisma.lead.findFirst({
    where: {
      source: SOURCE,
      receivedAt: { gte: new Date(now - SESSION_MAX_AGE_MS) },
      OR: [{ phone }, { rawFormData: { path: ["session_id"], equals: sessionId } }],
    },
    select: { id: true },
  });
  if (dup) return json({ ok: true, duplicate: true });

  if (ip !== "unknown") {
    const fromIp = await prisma.lead.count({
      where: {
        source: SOURCE,
        receivedAt: { gte: new Date(now - DAY_MS) },
        rawFormData: { path: ["server_ip"], equals: ip },
      },
    });
    if (fromIp >= DAILY_LEADS_PER_IP) {
      return reject("daily IP cap", ip, { error: "Too many requests." }, 429);
    }
  }

  // Keep the page's field order; drop anything not on the allowlist.
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) clean[k] = str(v).slice(0, MAX_FIELD_LEN);
  }
  Object.assign(clean, {
    full_name: name,
    name,
    phone,
    email,
    zip,
    source: SOURCE,
    lead_source: SOURCE,
    external_id: eventId,
    session_id: sessionId,
    server_ip: ip,
    // Meta requires the browser's user agent on website Conversions API events.
    // Internal only (hidden on the contact card; not part of the SignalDesk feed).
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400),
  });

  const lead = normalizeInboundLead(clean);
  const outcome = await createInboundLead(lead, {
    activityBody: `Lead received via ABCA quiz (${SOURCE}).`,
    // Prefer the browser-reported consent IP; fall back to the IP we observed.
    consentIp: clean.consent_ip || (ip !== "unknown" ? ip : undefined),
  });

  switch (outcome.status) {
    case "created":
      if (outcome.error) console.error(`[quiz/submit] lead ${outcome.leadId} post-create: ${outcome.error}`);
      return json({ ok: true });
    case "test":
      return json({ ok: true });
    case "duplicate":
      return json({ ok: true, duplicate: true });
    case "failed":
      console.error(`[quiz/submit] create failed: ${outcome.error}`);
      return json({ error: "Could not save your request." }, 500);
    default:
      return json({ error: "Invalid fields.", fields: ["phone"] }, 400);
  }
}
