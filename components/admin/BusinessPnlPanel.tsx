"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, TrendingUp, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface Pnl {
  range: string; sinceIso: string; untilIso: string;
  leadsGenerated: number; cplCents: number | null; adSpendCents: number; adSpendSource: string;
  clientRevenueCents: number; clientLeadsSold: number; stripeFeesCents: number;
  reimbursementCents: number; reimbursementPending: number; reimbursementPendingCents: number;
  netScenario2Cents: number; marginScenario2: number | null;
  netScenario1Cents: number; marginScenario1: number | null;
}
interface Settlement {
  id: string; name: string; email: string; periodStart: string; periodEnd: string;
  leadCount: number; cplCents: number; amountCents: number; status: string; paidAt: string | null;
}

const RANGES: [string, string][] = [["mtd", "This month"], ["7d", "7 days"], ["30d", "30 days"]];
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (f: number | null) => (f == null ? "—" : `${(f * 100).toFixed(1)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Admin-only Advertisely business P&L: client sales + paid house-lead reimbursements − ad spend − Stripe fees. */
export function BusinessPnlPanel() {
  const [range, setRange] = useState("mtd");
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/business-pnl?range=${range}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/admin/house-settlements`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([p, s]) => { setPnl(p); setSettlements(s?.settlements ?? []); })
      .finally(() => setLoading(false));
  }, [range]);
  useEffect(() => { load(); }, [load]);

  async function setPaid(id: string, status: "PAID" | "PENDING") {
    setBusyId(id);
    try {
      await fetch("/api/admin/house-settlements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      load();
    } finally { setBusyId(null); }
  }

  const src = pnl?.adSpendSource === "meta" ? "live Meta spend"
    : pnl?.adSpendSource === "manual-estimate" ? "est. (manual CPL × leads)"
    : "not available — set a CPL";

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-brand-red" />
          <h3 className="text-sm font-semibold">Business P&amp;L</h3>
          <span className="text-xs text-muted-foreground">Advertisely net — incl. house-lead reimbursements</span>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {RANGES.map(([v, l]) => (
            <button key={v} onClick={() => setRange(v)}
              className={cn("px-2.5 py-1 text-xs transition-colors", range === v ? "bg-brand-red text-white" : "bg-white text-muted-foreground hover:bg-slate-50")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 justify-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : !pnl ? (
        <div className="text-rose-600 text-sm py-6 text-center">Couldn&apos;t load the business P&amp;L.</div>
      ) : (
        <>
          {/* Headline: Scenario 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Net (admins pay)</div>
              <div className={cn("text-2xl font-bold leading-tight", pnl.netScenario2Cents >= 0 ? "text-emerald-700" : "text-rose-600")}>{usd(pnl.netScenario2Cents)}</div>
              <div className="text-[11px] text-muted-foreground">margin {pct(pnl.marginScenario2)}</div>
            </div>
            <Stat label="If admins don't pay" value={usd(pnl.netScenario1Cents)} sub={`margin ${pct(pnl.marginScenario1)}`} valueClass={pnl.netScenario1Cents >= 0 ? "" : "text-rose-600"} />
            <Stat label="Cost per lead" value={pnl.cplCents != null ? usd(pnl.cplCents) : "—"} sub={`${pnl.leadsGenerated} leads generated`} />
            <Stat label="Client lead sales" value={usd(pnl.clientRevenueCents)} sub={`${pnl.clientLeadsSold} leads sold`} />
          </div>

          {/* Breakdown */}
          <div className="mt-3 rounded-lg border border-slate-200 divide-y divide-slate-100 text-sm">
            {[
              ["Client lead sales (cash)", usd(pnl.clientRevenueCents), "text-foreground"],
              ["+ House-lead reimbursements (paid)", usd(pnl.reimbursementCents), "text-emerald-700"],
              [`− Ad spend (${src})`, "−" + usd(pnl.adSpendCents), "text-foreground"],
              ["− Stripe fees", "−" + usd(pnl.stripeFeesCents), "text-foreground"],
              ["= Net profit (admins pay)", usd(pnl.netScenario2Cents), "font-semibold text-emerald-700"],
            ].map(([label, val, cls], i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">{label}</span>
                <span className={cn("tabular-nums", cls)}>{val}</span>
              </div>
            ))}
          </div>

          {pnl.reimbursementPending > 0 && (
            <p className="mt-2 text-[11px] text-amber-700">
              {pnl.reimbursementPending} pending settlement{pnl.reimbursementPending === 1 ? "" : "s"} worth {usd(pnl.reimbursementPendingCents)} not yet counted — mark paid below to add them to net.
            </p>
          )}
          {pnl.adSpendSource === "none" && (
            <p className="mt-2 text-[11px] text-rose-600">Ad spend unavailable — set META_ADS_ACCESS_TOKEN + ad-account IDs in Vercel, or a manual CPL in Sources &amp; campaigns, for an accurate net.</p>
          )}

          {/* Settlements ledger */}
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">House-lead settlements</div>
            {settlements.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No settlements yet — the weekly invoice records them each Monday.</p>
            ) : (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-muted-foreground">
                    <tr><th className="text-left p-2 font-medium">Admin</th><th className="text-left p-2 font-medium">Week</th><th className="text-center p-2 font-medium">Leads × CPL</th><th className="text-right p-2 font-medium">Amount</th><th className="text-right p-2 font-medium">Status</th></tr>
                  </thead>
                  <tbody>
                    {settlements.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="p-2 font-medium">{s.name}</td>
                        <td className="p-2 text-muted-foreground">{day(s.periodStart)}–{day(s.periodEnd)}</td>
                        <td className="p-2 text-center text-muted-foreground">{s.leadCount} × {usd(s.cplCents)}</td>
                        <td className="p-2 text-right font-semibold tabular-nums">{usd(s.amountCents)}</td>
                        <td className="p-2 text-right">
                          {s.status === "PAID" ? (
                            <button disabled={busyId === s.id} onClick={() => setPaid(s.id, "PENDING")} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 font-medium hover:bg-emerald-200">
                              ✓ Paid
                            </button>
                          ) : (
                            <button disabled={busyId === s.id} onClick={() => setPaid(s.id, "PAID")} className="inline-flex items-center gap-1 rounded-full bg-brand-red text-white px-2 py-0.5 font-medium hover:opacity-90">
                              {busyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Mark paid"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={cn("text-2xl font-bold leading-tight", valueClass)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
