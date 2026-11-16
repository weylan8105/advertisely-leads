"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, CalendarClock, Wallet, Users, LogIn, Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AVAILABLE_STATES, stateName } from "@/data/states";
import { formatCurrency, cn } from "@/lib/utils";

interface ProgramData {
  available: boolean;
  offer: {
    name: string;
    amountCents: number;
    intervalWeeks: number;
    feeCents: number;
    creditCents: number;
    cardFeeRate: number;
    leadPriceCents: { low: number; high: number };
  };
  member: { status: string; startedAt: string | null; nextPaymentAt: string | null; cancelAtPeriodEnd: boolean } | null;
  joined: boolean;
  legacyUntil: string | null;
  legacyViaTeam?: boolean;
  mustJoin: boolean;
  licensedStates: string[];
  balance: { balanceCents: number; leads: number; costPerLeadCents: number | null; errors: boolean } | null;
}

const usd = (cents: number) => formatCurrency(cents / 100);
const usd0 = (cents: number) => formatCurrency(Math.round(cents / 100)).replace(/\.00$/, "");
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "—";

export function AdvertiserProgramPanel() {
  const [data, setData] = useState<ProgramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [states, setStates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/advertiser-program", { cache: "no-store" })
      .then((r) => {
        if (r.status === 401) { setNeedsAuth(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d: ProgramData | null) => {
        setData(d);
        if (d && !d.member && d.licensedStates.length) {
          setStates(d.licensedStates.filter((s) => (AVAILABLE_STATES as readonly string[]).includes(s)));
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    try {
      const p = new URLSearchParams(window.location.search).get("status");
      if (p === "success") setBanner({ ok: true, text: "Welcome to the Advertiser Program! Your balance is ready and leads start with the next one in your states." });
      if (p === "cancel") setBanner({ ok: false, text: "Checkout canceled. You weren't charged." });
      if (p) {
        const u = new URL(window.location.href);
        u.searchParams.delete("status");
        window.history.replaceState({}, "", u.pathname + u.search);
      }
    } catch {}
  }, []);

  const toggleState = (s: string) => setStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  async function join() {
    setError(null);
    if (states.length === 0) { setError("Pick the states you're licensed in."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/advertiser-program/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error ?? "Could not start checkout");
      window.location.href = d.url;
    } catch (e: any) {
      setError(e.message ?? "Could not start checkout");
      setBusy(false);
    }
  }

  async function setCancel(resume: boolean) {
    if (!resume && !window.confirm("Cancel the Advertiser Program? There are no more payments after this 2-week period, and any balance you have left keeps buying leads.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/advertiser-program/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not update your membership");
      setBanner({ ok: true, text: d.message });
      await load();
    } catch (e: any) {
      setError(e.message ?? "Could not update your membership");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-12 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (needsAuth) {
    return (
      <Card className="p-8 text-center max-w-xl mx-auto">
        <LogIn className="h-9 w-9 text-brand-red mx-auto mb-3" />
        <h3 className="text-lg font-semibold">Sign in to join</h3>
        <p className="text-sm text-muted-foreground mt-1">Log in to join the Advertisely Advertiser Program.</p>
        <a href="/login?callbackUrl=/marketplace?tab=advertise" className="inline-block mt-4">
          <Button>Sign in</Button>
        </a>
      </Card>
    );
  }

  if (!data?.available) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">The Advertiser Program isn&apos;t set up yet.</Card>;
  }

  const { offer } = data;
  const every = `every ${offer.intervalWeeks} weeks`;
  const leadsLow = Math.floor(offer.creditCents / Math.max(1, offer.leadPriceCents.high));
  const leadsHigh = Math.floor(offer.creditCents / Math.max(1, offer.leadPriceCents.low));
  const leadRange = leadsLow === leadsHigh ? `${leadsLow}` : `${leadsLow}–${leadsHigh}`;
  const priceRange =
    offer.leadPriceCents.low === offer.leadPriceCents.high
      ? usd(offer.leadPriceCents.low)
      : `${usd(offer.leadPriceCents.low)}–${usd(offer.leadPriceCents.high)}`;
  const cardFeePct = Math.round(offer.cardFeeRate * 100);

  const banners = (
    <>
      {banner && (
        <div className={cn("mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
          banner.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>
          {banner.ok ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />}
          {banner.text}
        </div>
      )}
      {!data.member && data.legacyUntil && (
        <div className={cn("mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
          data.mustJoin ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {data.mustJoin ? (
              <>{data.legacyViaTeam ? "Your upline's advertiser month" : "Your November advertiser fee"} covered you through <strong>{fmtDate(data.legacyUntil)}</strong>. Your leads are paused until you join the Advertiser Program below.</>
            ) : (
              <>{data.legacyViaTeam ? "Your upline's advertiser month" : "Your November advertiser fee"} covers you until <strong>{fmtDate(data.legacyUntil)}</strong>. From then on, advertiser leads come through the Advertiser Program, so join by that date to keep yours coming.</>
            )}
          </span>
        </div>
      )}
    </>
  );

  const howItWorks = (
    <Card className="p-6">
      <div className="text-sm font-semibold mb-2">How it works</div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Leads come from our Blue Collar campaigns, shared in a round robin between advertisers licensed in the lead&apos;s state.</li>
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Each lead costs what we paid for it, plus the {cardFeePct}% card fee. No markup on the leads.</li>
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Leads land in your pipeline the moment they come in, with an email for each one.</li>
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Your dashboard shows your balance, leads and cost per lead.</li>
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Cancel anytime. Whatever balance is left keeps buying leads.</li>
      </ul>
    </Card>
  );

  // Member
  if (data.member) {
    const m = data.member;
    const ending = m.cancelAtPeriodEnd;
    return (
      <div>
        {banners}
        <div className="grid gap-5 md:grid-cols-3">
          <Card className="p-5 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">{offer.name}</h3>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                ending ? "border-slate-200 bg-slate-50 text-slate-600"
                  : m.status === "past_due" ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                {ending ? `Ends ${fmtDate(m.nextPaymentAt)}` : m.status === "past_due" ? "Payment due" : "Active"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Member since {fmtDate(m.startedAt)}.</p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Megaphone className="h-3 w-3" /> {every[0].toUpperCase() + every.slice(1)}</div>
                <div className="text-xl font-semibold">{usd0(offer.amountCents)}</div>
                <div className="text-[11px] text-muted-foreground">{usd0(offer.creditCents)} goes to leads</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Balance</div>
                <div className="text-xl font-semibold">{data.balance && !data.balance.errors ? usd(data.balance.balanceCents) : "—"}</div>
                <div className="text-[11px] text-muted-foreground">for your next leads</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Leads</div>
                <div className="text-xl font-semibold">{data.balance?.leads ?? 0}</div>
                <div className="text-[11px] text-muted-foreground">
                  {data.balance?.costPerLeadCents ? `${usd(data.balance.costPerLeadCents)} per lead` : "so far"}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {ending ? "Last day" : "Next payment"}</div>
                <div className="text-sm font-semibold mt-1">{fmtDate(m.nextPaymentAt)}</div>
              </div>
            </div>
            {m.status === "past_due" && (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Your last payment didn&apos;t go through. Stripe will retry it; update your card from the receipt email if it keeps failing.
              </p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              Full details of your payments and leads are on your <a href="/dashboard" className="font-medium text-brand-red hover:underline">dashboard</a>.
            </p>
            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
            <div className="mt-4">
              {ending ? (
                <Button size="sm" onClick={() => setCancel(true)} disabled={busy}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Keep my membership
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setCancel(false)} disabled={busy}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Cancel membership
                </Button>
              )}
            </div>
          </Card>
          {howItWorks}
        </div>
      </div>
    );
  }

  // Join
  return (
    <div>
      {banners}
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="p-6 md:col-span-2">
          <h3 className="text-lg font-semibold">{offer.name}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Become an advertiser right here: your money runs through our campaigns and buys leads at our cost. We keep a 20%
            management fee and that&apos;s it.
          </p>
          <dl className="mt-4 max-w-sm space-y-1.5 text-sm">
            <div className="flex justify-between gap-4"><dt>You pay {every}</dt><dd className="font-medium">{usd(offer.amountCents)}</dd></div>
            <div className="flex justify-between gap-4 text-muted-foreground"><dt>Management fee (20%)</dt><dd>− {usd(offer.feeCents)}</dd></div>
            <div className="flex justify-between gap-4 border-t border-slate-100 pt-1.5 font-semibold"><dt>Goes to your leads</dt><dd>{usd(offer.creditCents)}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            Today a lead costs about <span className="font-medium text-foreground">{priceRange}</span> including the {cardFeePct}% card fee,
            so {usd0(offer.creditCents)} is about <span className="font-medium text-foreground">{leadRange} leads</span> {every}. Costs follow our
            campaigns, so this moves up and down.
          </p>

          <h3 className="text-lg font-semibold mt-6">States you&apos;re licensed in</h3>
          <p className="text-sm text-muted-foreground mt-1">You only get leads from these states. This also updates your profile.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {AVAILABLE_STATES.map((s) => {
              const on = states.includes(s);
              return (
                <button key={s} type="button" title={stateName(s)} onClick={() => toggleState(s)}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    on ? "border-brand-red bg-brand-red/[0.06] text-brand-red font-medium" : "border-slate-200 hover:border-slate-300")}>
                  {s}
                </button>
              );
            })}
          </div>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <Button className="mt-5" onClick={join} disabled={busy || states.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Join for {usd0(offer.amountCents)} {every}
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Billed {every} until you cancel. Cancel anytime; whatever balance is left keeps buying leads.
          </p>
        </Card>
        {howItWorks}
      </div>
    </div>
  );
}
