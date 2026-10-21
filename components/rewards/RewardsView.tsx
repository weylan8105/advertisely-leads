"use client";

import { useEffect, useState } from "react";
import { Check, Coins, Copy, Loader2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
import { BUCKS_PER_REFERRED_LEAD_CENTS, REFERRAL_DISCOUNT_RATE } from "@/lib/referralPricing";

interface RewardsData {
  code: string | null;
  bucksEnabled: boolean;
  bucksCents: number;
  referredOrders: number;
  history: { id: string; amountCents: number; kind: string; note: string | null; createdAt: string }[];
}

const money = (c: number) => formatCurrency(c / 100);

/** Advertisely Bucks Marketing Campaign (draft): manage your code, see your Bucks. */
export function RewardsView() {
  const [d, setD] = useState<RewardsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () =>
    fetch("/api/referral")
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setD(j) : setError(j.error ?? "Couldn't load your rewards")))
      .catch(() => setError("Couldn't load your rewards"));
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/referral", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: draft }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setSaveErr(j.error ?? "Couldn't save that code");
      setEditing(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    });
  }

  const pct = Math.round(REFERRAL_DISCOUNT_RATE * 100);
  const perLead = money(BUCKS_PER_REFERRED_LEAD_CENTS);
  const shareText = d?.code
    ? `Use my code ${d.code} on Advertisely for ${pct}% off fresh IUL leads: https://advertisely.io`
    : "";

  return (
    <div>
      <PageHeader
        eyebrow="Advertisely Bucks"
        title="Your code & Bucks"
        description={`Anyone who orders with your code gets ${pct}% off fresh leads. You earn ${perLead} in Advertisely Bucks for every fresh lead they buy, and Bucks pay for your own lead orders. No limits on either.`}
      />

      {error ? (
        <Card className="p-8 text-center text-sm text-rose-600">{error}</Card>
      ) : !d ? (
        <Card className="p-12 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Code */}
          <Card className="p-6">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your code</div>
            {editing ? (
              <div className="mt-3 space-y-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  maxLength={20}
                  className="font-mono text-lg tracking-wider"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">4–20 letters or numbers. Your old code stops working once you change it.</p>
                {saveErr && <p className="text-xs text-rose-600">{saveErr}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={save} disabled={saving || draft.length < 4}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save code
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setSaveErr(null); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-3">
                  <span className="font-mono text-3xl font-semibold tracking-wider">{d.code ?? "—"}</span>
                  {d.code && (
                    <button
                      onClick={() => copy(d.code!, "code")}
                      className="text-muted-foreground hover:text-foreground"
                      title="Copy code"
                    >
                      {copied === "code" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setDraft(d.code ?? ""); setEditing(true); }}>
                    <Pencil className="h-3.5 w-3.5" /> Change code
                  </Button>
                  {d.code && (
                    <Button size="sm" variant="outline" onClick={() => copy(shareText, "share")}>
                      {copied === "share" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy share message
                    </Button>
                  )}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {d.referredOrders} order{d.referredOrders === 1 ? "" : "s"} placed with your code so far.
                </p>
              </>
            )}
          </Card>

          {/* Bucks */}
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Advertisely Bucks</div>
              <Coins className="h-5 w-5 text-emerald-600" />
            </div>
            {d.bucksEnabled ? (
              <>
                <div className="mt-2 text-3xl font-semibold tabular-nums text-emerald-700">{money(d.bucksCents)}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Apply them at checkout on your next lead order. 25 leads bought with your code = {money(25 * BUCKS_PER_REFERRED_LEAD_CENTS)}.
                </p>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="text-xs font-medium mb-2">History</div>
                  {d.history.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nothing yet. Share your code to start earning.</p>
                  ) : (
                    <ul className="space-y-1.5 max-h-72 overflow-auto">
                      {d.history.map((h) => (
                        <li key={h.id} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-muted-foreground">
                            {new Date(h.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {h.note ?? h.kind}
                          </span>
                          <span className={cn("shrink-0 font-semibold tabular-nums", h.amountCents >= 0 ? "text-emerald-600" : "text-slate-700")}>
                            {h.amountCents >= 0 ? "+" : "−"}{money(Math.abs(h.amountCents))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Admin accounts don&apos;t earn or spend Bucks. Your code still gives buyers {pct}% off.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
