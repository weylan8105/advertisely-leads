"use client";

import { X, Phone, Mail, MapPin, ShieldCheck, ClipboardList } from "lucide-react";
import type { Lead } from "@/types";
import { localTimeForState } from "@/data/states";
import { formatCurrency } from "@/lib/utils";

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
  quiz_iul_interest: "IUL Interest",
  quiz_household_income: "Household Income",
  quiz_monthly_contribution: "Monthly Contribution",
  quiz_lead_tier: "Lead Tier",
};
const QUIZ_ORDER = [
  "quiz_iul_interest",
  "quiz_household_income",
  "quiz_monthly_contribution",
  "quiz_lead_tier",
];

export function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const local = localTimeForState(lead.state);
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
      ["Age", lead.age ? String(lead.age) : ""],
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight truncate">{lead.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" /> {lead.phone}
              </span>
              {lead.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {lead.email}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {lead.state}
                {local ? ` · ${local} local` : ""}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto scrollbar-thin space-y-6">
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
                <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium text-right break-words">{v}</span>
                </div>
              ))}
            </div>
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
    </div>
  );
}
