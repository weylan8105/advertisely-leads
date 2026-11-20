import { prisma } from "./prisma";
import { sharedPoolOf, type SharedPool } from "./sharedPool";
import { splitName } from "./ghl";
import { sendGoldmineLeadAlertEmail, isEmailConfigured } from "./email";

/**
 * Texts to new leads, sent from Enhanced Wealth's GHL number (A2P approved),
 * so the person knows who is about to call and recognises the number:
 *
 *   • "arrival"     — the moment a lead is routed: names the agent (or the
 *                     advertiser's agency, for a team Goldmine lead).
 *   • "missed-call" — the first time an agent moves the card New Lead → Dialed:
 *                     "<agent> with <agency> just tried you from <number>".
 *
 * A team Goldmine lead also emails that team's agents, so someone calls fast.
 *
 * Off unless LEAD_TEXTS_ENABLED=1 and GHL_TEXT_TOKEN (a Private Integration
 * token for the Enhanced Wealth sub-account) are set. Only pools whose consent
 * names Enhanced Wealth text by default (LEAD_TEXTS_POOLS overrides). Never
 * outside 8am–9pm in the lead's state (TCPA quiet hours). One of each kind per
 * lead, logged on the lead's timeline (SMS_SENT). GHL handles STOP opt-outs.
 */

const GHL_API = "https://services.leadconnectorhq.com";
const TOKEN = process.env.GHL_TEXT_TOKEN || "";
const LOCATION_ID = process.env.GHL_TEXT_LOCATION_ID || "oUIcEWjNtiWharOxDKPE"; // Enhanced Wealth sub-account
const BRAND = "Enhanced Wealth";
// ABCA and Enhanced Wealth consent text both name Enhanced Wealth. The EWWS and
// nurse forms' consent hasn't been checked yet, so they stay off by default.
const DEFAULT_POOLS: SharedPool[] = ["ew", "abca"];

export type LeadTextKind = "arrival" | "missed-call";

export function leadTextsEnabled(env = process.env): boolean {
  return env.LEAD_TEXTS_ENABLED === "1" && !!env.GHL_TEXT_TOKEN;
}

export function textPools(env = process.env): Set<string> {
  const raw = env.LEAD_TEXTS_POOLS?.trim();
  return new Set(raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_POOLS);
}

// ── Quiet hours ────────────────────────────────────────────────────────
// One timezone per state (the one most of its people are in): good enough for
// an 8am–9pm window. Unknown states fall back to Central.
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver",
};

/** True when it's 8:00–20:59 local time in the lead's state. */
export function withinTextingHours(state: string | null | undefined, now = new Date()): boolean {
  const tz = STATE_TZ[(state || "").toUpperCase()] ?? "America/Chicago";
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 8 && hour < 21;
}

// ── Message text ───────────────────────────────────────────────────────
export function formatPhone(raw: string | null | undefined): string | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

const firstName = (name: string | null | undefined) => (name || "").trim().split(/\s+/)[0] || "";

/** "Josh Smith with Smith Insurance", "Josh Smith", or the agency alone. */
function whoLine(agent: { name?: string | null; agency?: string | null } | null): string | null {
  const name = agent?.name?.trim();
  const agency = agent?.agency?.trim();
  if (name && agency) return `${name} with ${agency}`;
  return name || agency || null;
}

export function arrivalText(opts: {
  leadName: string;
  agent: { name?: string | null; agency?: string | null; phone?: string | null } | null;
  team?: boolean; // a team Goldmine lead: name the agency, not one agent
}): string {
  const hi = firstName(opts.leadName) ? `Hi ${firstName(opts.leadName)}, ` : "Hi, ";
  const phone = opts.team ? null : formatPhone(opts.agent?.phone);
  const who = opts.team
    ? opts.agent?.agency?.trim() || (opts.agent?.name ? `${opts.agent.name.trim()}'s team` : null)
    : whoLine(opts.agent);
  const body = who
    ? opts.team
      ? `a licensed agent with ${who} will call you shortly about the coverage you asked for.`
      : `your licensed agent is ${who}. They'll call you shortly${phone ? ` from ${phone}` : ""} about the coverage you asked for.`
    : `a licensed agent will call you shortly about the coverage you asked for.`;
  return `${hi}it's ${BRAND}: ${body} Save the number so you know it's us. Reply STOP to opt out.`;
}

export function missedCallText(opts: {
  leadName: string;
  caller: { name?: string | null; agency?: string | null; phone?: string | null };
}): string | null {
  const phone = formatPhone(opts.caller.phone);
  const who = whoLine(opts.caller);
  if (!phone || !who) return null; // the point is the name + number; without them, don't send
  const hi = firstName(opts.leadName) ? `Hi ${firstName(opts.leadName)}, ` : "Hi, ";
  return `${hi}sorry we missed you. ${who} just tried to reach you about your coverage request from ${phone}. Call or text back anytime. - ${BRAND}. Reply STOP to opt out.`;
}

// ── GHL ────────────────────────────────────────────────────────────────
async function ghl<T>(path: string, version: string, body: unknown): Promise<T> {
  const res = await fetch(`${GHL_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, Version: version, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.message ? String(data.message) : `GHL ${res.status}`);
  return data as T;
}

async function contactIdFor(lead: { ghlContactId?: string | null; name: string; phone: string; email?: string | null }): Promise<string> {
  if (lead.ghlContactId) return lead.ghlContactId;
  const { firstName: fn, lastName: ln } = splitName(lead.name);
  const data = await ghl<{ contact?: { id: string } }>("/contacts/upsert", "2021-07-28", {
    locationId: LOCATION_ID,
    firstName: fn,
    lastName: ln,
    phone: lead.phone,
    email: lead.email || undefined,
    tags: ["advertisely-text"],
    source: "Advertisely",
  });
  if (!data.contact?.id) throw new Error("GHL didn't return a contact id");
  return data.contact.id;
}

async function alreadySent(leadId: string, kind: LeadTextKind): Promise<boolean> {
  if (!prisma) return true;
  const n = await prisma.leadActivity.count({
    where: { leadId, type: "SMS_SENT", metadata: { path: ["kind"], equals: kind } },
  });
  return n > 0;
}

type TextLead = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  state: string;
  source: string;
  packageId?: string | null;
  rawFormData?: unknown;
  campaignName?: string | null;
  ghlContactId?: string | null;
  pipelineStage?: string | null;
};

/** Send one text to a lead, at most once per kind. Never throws. */
async function sendLeadText(lead: TextLead, kind: LeadTextKind, message: string, author?: string): Promise<string> {
  try {
    if (!prisma) return "skipped: no database";
    if (lead.pipelineStage === "dnc") return "skipped: DNC";
    if (!withinTextingHours(lead.state)) return "skipped: outside 8am-9pm local";
    if (await alreadySent(lead.id, kind)) return "skipped: already sent";
    const contactId = await contactIdFor(lead);
    await ghl("/conversations/messages", "2021-04-15", { type: "SMS", contactId, message });
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "SMS_SENT",
        author: author ?? "Advertisely",
        body: `Text sent (${kind === "arrival" ? "new lead" : "missed call"}): ${message}`,
        metadata: { kind, via: "ghl", contactId },
      },
    });
    return "sent";
  } catch (e) {
    console.warn(`[lead-texts] ${kind} for lead ${lead.id} not sent:`, (e as Error).message);
    return `error: ${(e as Error).message}`;
  }
}

function inTextPool(lead: TextLead): boolean {
  const pool = sharedPoolOf(lead as any);
  return !!pool && textPools().has(pool);
}

const LEAD_SELECT = {
  id: true, name: true, phone: true, email: true, state: true, source: true, packageId: true, rawFormData: true,
  campaignName: true, ghlContactId: true, pipelineStage: true, pipeline: true, assignedUserId: true, organizationId: true,
} as const;

/**
 * After a new lead is routed: text it who'll call, and alert the team when it
 * landed in their Goldmine. Safe to call for any lead; does nothing if the lead
 * wasn't assigned, isn't in a texting pool, or texts are off. Never throws.
 */
export async function notifyLeadRouted(leadId: string): Promise<void> {
  try {
    if (!prisma) return;
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: LEAD_SELECT });
    if (!lead?.assignedUserId) return;
    const team = lead.pipeline === "goldmine";
    const owner = await prisma.user.findUnique({
      where: { id: lead.assignedUserId },
      select: { name: true, agency: true, phone: true },
    });

    if (team && lead.organizationId) await alertGoldmineTeam(lead, owner?.agency || owner?.name || null);

    if (!leadTextsEnabled() || !inTextPool(lead as TextLead)) return;
    await sendLeadText(lead as TextLead, "arrival", arrivalText({ leadName: lead.name, agent: owner, team }));
  } catch (e) {
    console.warn("[lead-texts] notifyLeadRouted failed:", (e as Error).message);
  }
}

/**
 * The first time a lead goes New Lead → Dialed: text it who just called and
 * from which number. `callerId` is whoever moved the card. Never throws.
 */
export async function notifyMissedCall(leadId: string, callerId: string): Promise<string> {
  try {
    if (!prisma || !leadTextsEnabled()) return "skipped: texts off";
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: LEAD_SELECT });
    if (!lead || !inTextPool(lead as TextLead)) return "skipped: not a texting pool";
    const caller = await prisma.user.findUnique({ where: { id: callerId }, select: { name: true, agency: true, phone: true } });
    const message = caller ? missedCallText({ leadName: lead.name, caller }) : null;
    if (!message) return "skipped: caller has no name or phone on their profile";
    return sendLeadText(lead as TextLead, "missed-call", message, caller?.name ?? undefined);
  } catch (e) {
    console.warn("[lead-texts] notifyMissedCall failed:", (e as Error).message);
    return `error: ${(e as Error).message}`;
  }
}

/** Email every agent with Goldmine access on the lead's team: a new lead is waiting. */
async function alertGoldmineTeam(
  lead: { id: string; name: string; state: string; organizationId: string | null },
  teamLabel: string | null,
): Promise<void> {
  if (!prisma || !lead.organizationId || !isEmailConfigured || process.env.GOLDMINE_LEAD_ALERTS === "0") return;
  const org = await prisma.organization.findUnique({
    where: { id: lead.organizationId },
    select: { name: true, ownerId: true, memberships: { where: { goldmineBlocked: false }, select: { userId: true } } },
  });
  if (!org) return;
  const ids = [...new Set([org.ownerId, ...org.memberships.map((m) => m.userId)])];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true, name: true } });
  for (const u of users) {
    if (!u.email) continue;
    await sendGoldmineLeadAlertEmail({
      toEmail: u.email,
      agentName: u.name ?? "there",
      teamName: teamLabel || org.name,
      leadFirstName: firstName(lead.name),
      leadState: lead.state,
    }).catch(() => {});
  }
}
