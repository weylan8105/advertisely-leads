"use client";

import { useEffect, useState } from "react";
import { Loader2, X, ArrowRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PipelineBoard } from "@/components/leads/PipelineBoard";
import { formatCurrency, cn } from "@/lib/utils";
import type { Lead } from "@/types";

interface Account {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  agency: string | null;
  delivered: number;
  byStage: Record<string, number>;
  sold: number;
  apCents: number;
  leadSpendCents: number;
  lastOrderAt: string | null;
  conversionPct: number;
}

const money = (c: number) => formatCurrency(Math.round(c) / 100);

function metrics(a: Account) {
  const intake = (a.byStage["new-lead"] ?? 0) + (a.byStage["aged-lead"] ?? 0);
  const working = Math.max(0, a.delivered - intake);
  const quoted =
    (a.byStage["presentation-ran"] ?? 0) + (a.byStage["underwriting"] ?? 0) + (a.byStage["approved"] ?? 0);
  return { working, quoted };
}

export function AdminAccounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Account | null>(null);

  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setAccounts(d.accounts ?? []))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-rose-600 text-sm py-8 text-center">Couldn&apos;t load accounts: {error}</div>;
  if (!accounts)
    return (
      <div className="flex items-center gap-2 justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
      </div>
    );

  return (
    <>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-slate-200">
              <th className="text-left py-2 font-medium">Account</th>
              <th className="text-right py-2 font-medium">Delivered</th>
              <th className="text-right py-2 font-medium">Working</th>
              <th className="text-right py-2 font-medium">Quoted</th>
              <th className="text-right py-2 font-medium">Sold</th>
              <th className="text-right py-2 font-medium">Conv.</th>
              <th className="text-right py-2 font-medium">AP</th>
              <th className="text-right py-2 font-medium">Spend</th>
              <th className="text-right py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const m = metrics(a);
              return (
                <tr key={a.userId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5">
                    <div className="font-medium flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-brand-red shrink-0" />
                      {a.name ?? a.email.split("@")[0]}
                      {a.role === "ADMIN" && <Badge variant="muted" className="text-[9px]">Admin</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{a.email}{a.agency ? ` · ${a.agency}` : ""}</div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{a.delivered}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{m.working}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{m.quoted}</td>
                  <td className="py-2.5 text-right tabular-nums font-medium text-emerald-600">{a.sold}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    <span
                      className={cn(
                        "font-semibold",
                        a.conversionPct >= 5 ? "text-emerald-600" : a.conversionPct > 0 ? "text-amber-600" : "text-muted-foreground",
                      )}
                    >
                      {a.conversionPct}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{a.apCents ? money(a.apCents) : "—"}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{money(a.leadSpendCents)}</td>
                  <td className="py-2.5 text-right">
                    <Button size="sm" variant="outline" onClick={() => setViewing(a)}>
                      View CRM <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                  No client accounts with leads or orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Working = leads moved past intake · Quoted = presentation/underwriting/approved · Conv. = policies sold ÷ delivered.
        Click <span className="font-medium">View CRM</span> to see any account&apos;s full pipeline.
      </p>

      {viewing && <AccountBoardModal account={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function AccountBoardModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/leads?email=${encodeURIComponent(account.email)}`)
      .then((r) => r.json())
      .then((d) => setLeads(Array.isArray(d.leads) ? d.leads : []))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [account.email]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[88vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{account.name ?? account.email} — pipeline</h2>
            <p className="text-xs text-muted-foreground">
              {account.delivered} leads · {account.sold} sold ({account.conversionPct}% conversion) · {money(account.leadSpendCents)} spend
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center gap-2 justify-center py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading {account.name ?? "account"}&apos;s pipeline…
            </div>
          ) : (
            <PipelineBoard leads={leads} setLeads={setLeads} />
          )}
        </div>
      </div>
    </div>
  );
}
