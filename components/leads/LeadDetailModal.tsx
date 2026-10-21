"use client";

import { useEffect, useState } from "react";
import { X, Phone, Mail, MapPin, ShieldCheck, ClipboardList, RefreshCw, Loader2, Check, StickyNote, DollarSign, Copy, MessageSquare } from "lucide-react";
import type { Lead, LeadNote } from "@/types";
import { localTimeForState } from "@/data/states";
import { formatCurrency, cn } from "@/lib/utils";
import { FUNNEL_LEAD_LABEL } from "@/lib/leadOrigin";
import { ReplacementReasonDialog } from "@/components/leads/ReplacementReasonDialog";
import { LeadMessages } from "@/components/leads/LeadMessages";
import { replacementWindowClosed, REPLACEMENT_WINDOW_HOURS } from "@/lib/replacementReasons";

function prettyKey(k: string) {
  return k
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\?$/, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
function prettyVal(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    try {
      return Object.entries(v as Record<string, unknown>)
        .map(([k, val]) => `${prettyKey(k)}: ${val}`)
        .join(" · ");
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// Backend / tracking / redundant fields agents should never see on a lead card.
// (Everything here is either shown elsewhere in the modal, or is internal
// marketing/attribution plumbing.)
const HIDDEN_KEYS = new Set(
  [
    // identity — already in the header / Lead details
    "first_name", "last_name", "full_name", "name", "phone", "phone_number", "email",
    "email_address", "state", "occupation", "trade", "age", "intent", "intent_reason",
    "reason", "why", "source", "packageid", "package_id", "package",
    // consent — shown in the TCPA box
    "consent_given", "consent_language", "consent_timestamp", "consent_ip", "consent", "tcpa",
    // Meta / tracking / attribution plumbing
    "fbc", "fbp", "fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "event_id", "event_name", "lead_source", "landing_url", "submitted_at",
    "campaign", "campaign_name", "campaign_id", "adset", "adset_id", "adset_name",
    "ad_id", "ad_name", "adgroup_id", "creative", "creative_id", "page_id",
    "form_id", "form_name", "leadgen_id", "created_time", "platform", "is_organic",
    "partner_name", "user_agent", "client_user_agent", "external_id", "id", "lead_id",
  ].map((k) => k.toLowerCase()),
);

// Quiz answers that duplicate Lead details — hidden to avoid repetition.
const HIDDEN_QUIZ = new Set(["quiz_trade", "quiz_age"]);

// Nicer labels + priority order for the quiz answers shown up top.
const QUIZ_LABELS: Record<string, string> = {
  quiz_iul_interest: "What matters most",
  quiz_coverage: "Coverage wanted",
  quiz_beneficiary: "Beneficiary",
  quiz_household_income: "Household Income",
  quiz_monthly_contribution: "Monthly Contribution",
  quiz_lead_tier: "Lead Tier",
};
const QUIZ_ORDER = [
  "quiz_iul_interest",
  "quiz_coverage",
  "quiz_beneficiary",
  "quiz_household_income",
  "quiz_monthly_contribution",
  "quiz_lead_tier",
];

export function LeadDetailModal({
  lead,
  onClose,
  onNoteAdded,
  onValueChanged,
  onAssigned,
  context = "agent",
}: {
  lead: Lead;
  onClose: () => void;
  onNoteAdded?: (leadId: string, note: LeadNote) => void;
  onValueChanged?: (leadId: string, valueCents: number | null) => void;
  /** Called after the lead is moved to another agent's pipeline. */
  onAssigned?: (leadId: string, userId: string, agentName: string) => void;
  /** "admin" opens the card from the leads database (hides agent-only actions). */
  context?: "agent" | "admin";
}) {
  const local = localTimeForState(lead.state);
  const isFunnelLead = lead.originLabel === FUNNEL_LEAD_LABEL;
  const raw = lead.rawFormData ?? {};
  const rawEntries = Object.entries(raw).filter(([, v]) => prettyVal(v).trim() !== "");

  // Quiz answers (surfaced at the top), sorted by priority.
  const quizEntries = rawEntries
    .filter(([k]) => k.toLowerCase().startsWith("quiz_") && !HIDDEN_QUIZ.has(k.toLowerCase()))
    .sort((a, b) => {
      const ia = QUIZ_ORDER.indexOf(a[0].toLowerCase());
      const ib = QUIZ_ORDER.indexOf(b[0].toLowerCase());
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  // Any other genuine form answers (e.g. Meta lead-form questions) — minus the
  // backend/tracking/redundant keys.
  const otherEntries = rawEntries.filter(
    ([k]) => !k.toLowerCase().startsWith("quiz_") && !HIDDEN_KEYS.has(k.toLowerCase()),
  );

  const facts: [string, string][] = (
    [
      ["Phone", lead.phone],
      ["Email", lead.email],
      ["State", lead.state],
      ["ZIP", lead.zip || ""],
      ["Age", lead.ageRange || (lead.age ? String(lead.age) : "")],
      ["Income", lead.income ? formatCurrency(lead.income) : ""],
      ["Occupation", lead.occupation],
      ["Lead type", lead.leadTypeLabel],
    ] as [string, string][]
  ).filter(([, v]) => v);

  const consentTime = lead.consent?.timestamp
    ? new Date(lead.consent.timestamp).toLocaleString()
    : "";
  const consentLanguage = (() => {
    const hit = Object.entries(raw).find(([k]) => k.toLowerCase() === "consent_language");
    return hit ? prettyVal(hit[1]) : "";
  })();

  // Assign this lead to a downline agent's pipeline (team owners/managers only).
  const [team, setTeam] = useState<{ userId: string; name: string | null; email: string; isSelf?: boolean }[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setCanAssign(!!d.canManage); setTeam(d.members ?? []); } })
      .catch(() => {});
  }, []);
  async function assignTo(userId: string, agentName: string, force = false): Promise<void> {
    if (!force && !window.confirm(`Move ${lead.name} into ${agentName}'s pipeline?`)) return;
    setAssigning(true);
    setAssignMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...(force ? { force: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422 && !force) {
        // Outside that agent's order (state/age) — let the owner knowingly override.
        const msg = String(data.error || "This lead doesn't match that agent's order.").replace(/ Pass force:true to override\.?/, "");
        setAssigning(false);
        if (window.confirm(`${msg}\n\nAssign it anyway?`)) return assignTo(userId, agentName, true);
        return;
      }
      if (!res.ok) { setAssignMsg({ ok: false, text: data.error || "Couldn't assign the lead." }); return; }
      setAssignMsg({ ok: true, text: `Moved to ${agentName}'s pipeline.` });
      onAssigned?.(lead.id, userId, agentName);
    } catch {
      setAssignMsg({ ok: false, text: "Couldn't assign the lead." });
    } finally {
      setAssigning(false);
    }
  }

  // One-click copy for any contact detail, with a brief ✓. Copying also makes this
  // the "current" lead highlighted on the pipeline (same key the board uses).
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(text: string, key: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1300);
      try { localStorage.setItem("pipeline_active_lead", lead.id); } catch { /* ignore */ }
    } catch {
      /* clipboard unavailable */
    }
  }
  const telDigits = (lead.phone || "").replace(/[^\d+]/g, "");
  const place = `${lead.state || ""}${lead.zip ? ` ${lead.zip}` : ""}`.trim();
  const allContact = [lead.name, lead.phone, lead.email, place].filter(Boolean).join("\n");
  const CopyMark = ({ k }: { k: string }) =>
    copied === k ? <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> : <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover/cp:opacity-60 transition-opacity" />;

  // Editable opportunity value ($) — shown on the card + summed per stage.
  const [valueInput, setValueInput] = useState(
    lead.valueCents != null ? String(lead.valueCents / 100) : "",
  );
  const [valueSaving, setValueSaving] = useState(false);
  const [valueMsg, setValueMsg] = useState<"saved" | "error" | null>(null);
  async function saveValue() {
    setValueSaving(true);
    setValueMsg(null);
    const trimmed = valueInput.replace(/[^0-9.]/g, "").trim();
    const valueCents = trimmed === "" ? null : Math.round(parseFloat(trimmed) * 100);
    try {
      const res = await fetch(`/api/leads/${lead.id}/value`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valueCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setValueMsg("saved");
        onValueChanged?.(lead.id, data.valueCents ?? null);
        setValueInput(data.valueCents != null ? String(data.valueCents / 100) : "");
      } else {
        setValueMsg("error");
      }
    } catch {
      setValueMsg("error");
    } finally {
      setValueSaving(false);
    }
  }

  // Agent notes on this lead.
  const [notes, setNotes] = useState<LeadNote[]>(lead.notes ?? []);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteErr, setNoteErr] = useState("");
  async function addNote() {
    const text = noteDraft.trim();
    if (!text) return;
    setNoteSaving(true);
    setNoteErr("");
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.note) {
        setNotes((prev) => [data.note as LeadNote, ...prev]);
        setNoteDraft("");
        onNoteAdded?.(lead.id, data.note as LeadNote);
      } else {
        setNoteErr(data.error || "Could not save the note.");
      }
    } catch {
      setNoteErr("Could not save the note.");
    } finally {
      setNoteSaving(false);
    }
  }

  // Lead replacement request (files to the admin Replacement queue).
  const [rep, setRep] = useState<"idle" | "loading" | "done" | "denied">("idle");
  const [repErr, setRepErr] = useState("");
  const [capExceeded, setCapExceeded] = useState(false);
  const [repOpen, setRepOpen] = useState(false);
  const windowClosed = replacementWindowClosed(lead.assignedAt);
  async function submitReplacement(reasonCode: string, detail: string) {
    setRep("loading");
    setRepErr("");
    setCapExceeded(false);
    try {
      const res = await fetch("/api/admin/replacements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, reasonCode, reason: detail || "No detail provided" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) { setRep("done"); setRepOpen(false); }
      else { setRep(data.alreadyDenied ? "denied" : "idle"); setRepErr(data.error || "Could not submit the request."); setCapExceeded(!!data.capExceeded); setRepOpen(false); }
    } catch {
      setRep("idle");
      setRepErr("Could not submit the request.");
      setRepOpen(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copy(lead.name, "name")}
                title="Click to copy name"
                className="group/cp inline-flex min-w-0 items-center gap-1.5 text-left hover:text-brand-red"
              >
                <h2 className="text-2xl font-semibold tracking-tight truncate">{lead.name}</h2>
                <CopyMark k="name" />
              </button>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  isFunnelLead
                    ? "bg-brand-red/10 text-brand-red ring-1 ring-brand-red/20"
                    : "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
                )}
                title="Where this lead came from"
              >
                {lead.originLabel}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <button type="button" onClick={() => copy(lead.phone, "phone")} title="Click to copy number"
                className="group/cp inline-flex items-center gap-1 rounded hover:text-brand-red">
                <Phone className="h-3.5 w-3.5" /> <span className="font-mono">{lead.phone}</span> <CopyMark k="phone" />
              </button>
              {lead.email && (
                <button type="button" onClick={() => copy(lead.email, "email")} title="Click to copy email"
                  className="group/cp inline-flex items-center gap-1 rounded hover:text-brand-red">
                  <Mail className="h-3.5 w-3.5" /> {lead.email} <CopyMark k="email" />
                </button>
              )}
              <button type="button" onClick={() => copy(place, "place")} title="Click to copy state/ZIP"
                className="group/cp inline-flex items-center gap-1 rounded hover:text-brand-red">
                <MapPin className="h-3.5 w-3.5" /> {place}
                {local ? ` · ${local} local` : ""} <CopyMark k="place" />
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {telDigits && (
                <>
                  <a href={`tel:${telDigits}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:border-brand-red/40 hover:text-brand-red">
                    <Phone className="h-3.5 w-3.5" /> Call
                  </a>
                  <a href={`sms:${telDigits}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:border-brand-red/40 hover:text-brand-red">
                    <MessageSquare className="h-3.5 w-3.5" /> Text
                  </a>
                </>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:border-brand-red/40 hover:text-brand-red">
                  <Mail className="h-3.5 w-3.5" /> Email
                </a>
              )}
              <button type="button" onClick={() => copy(allContact, "all")}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:border-brand-red/40 hover:text-brand-red">
                {copied === "all" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "all" ? "Copied" : "Copy all"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canAssign && team.length > 1 && (
              <div className="flex flex-col items-end">
                <select
                  value=""
                  disabled={assigning}
                  onChange={(e) => {
                    const m = team.find((t) => t.userId === e.target.value);
                    if (m) void assignTo(m.userId, m.isSelf ? "your" : m.name ?? m.email);
                  }}
                  title="Move this lead into a downline agent's pipeline"
                  className="h-[30px] max-w-[11rem] rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-foreground hover:border-brand-red/40 focus:outline-none focus:ring-2 focus:ring-brand-red/15 disabled:opacity-60"
                >
                  <option value="">{assigning ? "Assigning…" : "Assign to…"}</option>
                  {team.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.isSelf ? "Me (my pipeline)" : m.name ?? m.email}
                    </option>
                  ))}
                </select>
                {assignMsg && (
                  <span className={cn("mt-1 text-[11px]", assignMsg.ok ? "text-emerald-600" : "text-rose-600")}>{assignMsg.text}</span>
                )}
              </div>
            )}
            {context !== "admin" && (
              <button
                onClick={() => { setRepErr(""); setRepOpen(true); }}
                disabled={rep === "loading" || rep === "done" || rep === "denied" || windowClosed}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  rep === "done"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 hover:border-slate-300 text-foreground disabled:opacity-60",
                )}
                title={windowClosed
                  ? `Replacement window closed (${REPLACEMENT_WINDOW_HOURS}h from delivery)`
                  : "Request a replacement for this lead"}
              >
                {rep === "loading" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : rep === "done" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {rep === "done"
                  ? "Replacement requested"
                  : rep === "denied"
                    ? "Replacement denied"
                    : windowClosed
                    ? "Replacement window closed"
                    : "Request replacement"}
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {repErr && (
          <div className="px-6 pt-2 text-xs text-rose-600">
            {repErr}
            {capExceeded && (
              <>
                {" "}
                <a href="/marketplace" className="font-semibold underline hover:text-rose-700">
                  Place a new order →
                </a>
              </>
            )}
          </div>
        )}

        <div className="p-6 overflow-y-auto scrollbar-thin space-y-6">
          {/* Opportunity value — editable; shows on the card + sums per stage. */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Lead value
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={valueInput}
                  onChange={(e) => { setValueInput(e.target.value); setValueMsg(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") saveValue(); }}
                  placeholder="0"
                  className="w-40 rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm focus:border-brand-red focus:outline-none focus:ring-1 focus:ring-brand-red"
                />
              </div>
              <button
                onClick={saveValue}
                disabled={valueSaving}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-red px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-redDark disabled:opacity-50"
              >
                {valueSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save value
              </button>
              {valueMsg === "saved" && <span className="text-xs text-emerald-600">Saved</span>}
              {valueMsg === "error" && <span className="text-xs text-rose-600">Couldn&apos;t save</span>}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Shown on the pipeline card and totaled at the top of each stage.</p>
          </div>

          {/* Quiz answers — the highest-value sales data, surfaced first. */}
          {quizEntries.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-brand-red mb-2 flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> Quiz answers
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {quizEntries.map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-brand-red/20 bg-brand-red/[0.03] p-3">
                    <div className="text-xs text-muted-foreground">
                      {QUIZ_LABELS[k.toLowerCase()] ?? prettyKey(k)}
                    </div>
                    <div className="text-sm font-semibold mt-0.5 break-words">{prettyVal(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Lead details</div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {facts.map(([k, v]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => copy(v, `fact-${k}`)}
                  title={`Click to copy ${k.toLowerCase()}`}
                  className="group/cp flex w-full justify-between gap-3 border-b border-slate-100 py-1.5 text-left hover:bg-slate-50 rounded-sm"
                >
                  <span className="text-muted-foreground">{k}</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-right break-words">
                    {v} <CopyMark k={`fact-${k}`} />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Text the lead (iMessage/SMS via Sendblue). */}
          <LeadMessages leadId={lead.id} leadName={lead.name} />

          {/* Agent notes — add and review notes on this lead. */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <StickyNote className="h-3.5 w-3.5" /> Notes
            </div>
            <div className="flex flex-col gap-2">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addNote();
                }}
                placeholder="Add a note about this lead…"
                rows={2}
                className="w-full resize-y rounded-lg border border-slate-200 p-2.5 text-sm focus:border-brand-red focus:outline-none focus:ring-1 focus:ring-brand-red"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-rose-600">{noteErr}</span>
                <button
                  onClick={addNote}
                  disabled={noteSaving || !noteDraft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-red px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-redDark disabled:opacity-50"
                >
                  {noteSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StickyNote className="h-3.5 w-3.5" />}
                  Add note
                </button>
              </div>
            </div>
            {notes.length > 0 && (
              <ul className="mt-3 space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {n.author}{n.at ? ` · ${new Date(n.at).toLocaleString()}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Free-text intent only for non-quiz leads (quiz interest is shown above). */}
          {quizEntries.length === 0 && lead.intentReason && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Why IUL / intent</div>
              <p className="text-sm">{lead.intentReason}</p>
            </div>
          )}

          {/* Any other genuine form answers (e.g. Meta lead-form questions). */}
          {otherEntries.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Other form answers
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {otherEntries.map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-muted-foreground">{prettyKey(k)}</div>
                    <div className="text-sm font-medium mt-0.5 break-words">{prettyVal(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lead.consent?.captured && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                <ShieldCheck className="h-4 w-4" /> TCPA consent captured
                <span className="ml-auto text-[11px] rounded-full bg-white border border-emerald-200 px-2 py-0.5 text-emerald-700">
                  Verified record
                </span>
              </div>
              <p className="mt-1.5 text-xs text-emerald-700/90">
                This lead agreed to be called and texted by a licensed agent, including by automated technology.
                {" "}
                {lead.consent.method}
                {consentTime ? ` · ${consentTime}` : ""}
                {lead.consent.ip ? ` · IP ${lead.consent.ip}` : ""}
              </p>
              {consentLanguage && (
                <p className="mt-2 text-[10px] leading-relaxed text-emerald-700/60 border-t border-emerald-200/70 pt-2">
                  <span className="font-medium">Consent language on record:</span> {consentLanguage}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <ReplacementReasonDialog
        open={repOpen}
        leadName={lead.name}
        busy={rep === "loading"}
        onClose={() => setRepOpen(false)}
        onSubmit={submitReplacement}
      />
    </div>
  );
}
