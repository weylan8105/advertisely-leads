"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, CalendarClock, Wallet, Users, LogIn, Megaphone, BadgeCheck } from "lucide-react";
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
    managementRate: number;
    cardFeeRate: number;
    leadPriceCents: { low: number; high: number };
  };
  member: {
    status: string;
    startedAt: string | null;
    nextPaymentAt: string | null;
    cancelAtPeriodEnd: boolean;
    freeUntil?: string | null;
    feeWaived?: boolean;
    savedCents?: number;
  } | null;
  // On the Enhanced Wealth team: the membership is waived for them.
  feeWaiver?: { label: string } | null;
  waiverEnded?: boolean;
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
  const [promo, setPromo] = useState("");
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
      if (p === "success") setBanner({ ok: true, text: "Welcome to the Advertiser Program! Add ad spend on your dashboard and your leads start with the next one in your states." });
      if (p === "waived") setBanner({ ok: true, text: "Welcome to the Advertiser Program! Your $500 membership is waived as part of the Enhanced Wealth team. Add ad spend on your dashboard and your leads start with the next one in your states." });
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
        body: JSON.stringify({ states, promoCode: promo.trim() || undefined }),
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
    const confirmText = data?.member?.feeWaived
      ? "Cancel the Advertiser Program? Your leads stop when this 2-week period ends, and any ad spend you have left stays on your account. You can rejoin free while you're on the Enhanced Wealth team."
      : "Cancel the Advertiser Program? There are no more payments after this 2-week period. Your leads stop when it ends, and any ad spend you have left stays on your account for when you rejoin.";
    if (!resume && !window.confirm(confirmText)) return;
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
  const priceRange =
    offer.leadPriceCents.low === offer.leadPriceCents.high
      ? usd(offer.leadPriceCents.low)
      : `${usd(offer.leadPriceCents.low)}–${usd(offer.leadPriceCents.high)}`;
  const cardFeePct = Math.round(offer.cardFeeRate * 100);
  // Enhanced Wealth team: the membership is waived (shown wherever the $500 would be).
  const waiver = data.feeWaiver ?? null;
  const waivedBadge = waiver && (
    <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-900">
      <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
      <div>
        <div className="font-semibold">{waiver.label}: membership fee waived</div>
        <div className="text-emerald-800">
          Advertisers normally pay {usd0(offer.amountCents)} {every} to be in the program. As part of the {waiver.label}, you pay $0.
        </div>
      </div>
    </div>
  );
  const mgmtPct = Math.round(offer.managementRate * 100);

  const banners = (
    <>
      {banner && (
        <div className={cn("mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
          banner.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>
          {banner.ok ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />}
          {banner.text}
        </div>
      )}
      {!data.member && data.waiverEnded && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Your membership fee was waived while you were on the Enhanced Wealth team. You&apos;ve left the team, so your leads are paused until you join at the regular price below.</span>
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
        {waiver ? (
          <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> The membership is normally {usd0(offer.amountCents)} {every}. It&apos;s waived for you as part of the {waiver.label}.</li>
        ) : (
          <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> {usd0(offer.amountCents)} {every} is your membership. It keeps you in the program and is separate from your ad spend.</li>
        )}
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> You add ad spend on your dashboard, any amount, whenever you like. All of it goes to leads.</li>
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Each lead costs what we paid for it, plus a {mgmtPct}% management fee and the {cardFeePct}% card fee.</li>
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Leads come from our Blue Collar campaigns, shared in a round robin between advertisers licensed in the lead&apos;s state, and land in your pipeline the moment they come in.</li>
        <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Cancel anytime. Leads keep coming until the 2 weeks you paid for run out, and any unused ad spend stays on your account for when you rejoin.</li>
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
            {m.freeUntil && !m.feeWaived && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <div className="font-semibold">Your first month is free</div>
                  <div className="text-emerald-800">
                    Your promo code covers your membership until <strong>{fmtDate(m.freeUntil)}</strong>.
                    {ending ? " Your membership ends that day." : <> Your first {usd0(offer.amountCents)} payment is that day, then {every}.</>}
                  </div>
                </div>
              </div>
            )}
            {m.feeWaived && waiver && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <div className="font-semibold">{waiver.label}: your {usd0(offer.amountCents)} membership is waived</div>
                  <div className="text-emerald-800">
                    You pay $0 {every} instead of {usd0(offer.amountCents)}.
                    {(m.savedCents ?? 0) > 0 && <> You&apos;ve saved <strong>{usd0(m.savedCents ?? 0)}</strong> so far by being on the {waiver.label}.</>}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className={cn("rounded-lg border p-3", m.feeWaived ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200")}>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Megaphone className="h-3 w-3" /> {every[0].toUpperCase() + every.slice(1)}</div>
                {m.feeWaived ? (
                  <>
                    <div className="text-xl font-semibold">
                      $0 <span className="text-sm font-normal text-muted-foreground line-through">{usd0(offer.amountCents)}</span>
                    </div>
                    <div className="text-[11px] font-medium text-emerald-700">membership waived</div>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-semibold">{usd0(offer.amountCents)}</div>
                    <div className="text-[11px] text-muted-foreground">membership</div>
                  </>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Ad spend left</div>
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
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {ending ? "Last day" : m.feeWaived ? "Renews" : m.freeUntil ? "First payment" : "Next payment"}</div>
                <div className="text-sm font-semibold mt-1">{fmtDate(m.nextPaymentAt)}</div>
                {m.feeWaived && !ending && <div className="text-[11px] text-emerald-700">$0, waived</div>}
              </div>
            </div>
            {m.status === "past_due" && (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Your last payment didn&apos;t go through. Stripe will retry it; update your card from the receipt email if it keeps failing.
              </p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              Add ad spend and see your leads on your <a href="/dashboard" className="font-medium text-brand-red hover:underline">dashboard</a>.
              Today a lead costs about <span className="font-medium text-foreground">{priceRange}</span> (our cost + {mgmtPct}% management + {cardFeePct}% card fee).
              {ending && <> Leads stop on your last day; unused ad spend stays on your account.</>}
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

  // Join: a sales page, so agents can sell themselves on it.
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const fee = `${usd0(offer.amountCents)}`;
  const disclaimer = (
    <p className="mx-auto mt-4 max-w-xl text-center text-[11px] text-muted-foreground">
      Results depend on how quickly and how well you follow up, your sales process, licensing and underwriting. We don&apos;t
      promise a specific cost per lead or any number of sales.
    </p>
  );
  const eyebrow = (t: string) => (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-red">{t}</div>
  );
  const steps = [
    ["Pick your states", "Choose the states you're licensed in below. You only get leads from those states."],
    waiver
      ? ["Join free", `Your ${fee} membership is waived for the ${waiver.label}. No card or sales call needed.`]
      : ["Join", `Pay your ${fee} membership through a secure Stripe checkout. No sales call needed.`],
    ["Add ad spend", "On your dashboard, add however much you want to put toward leads. Add more anytime."],
    ["Get leads", "New leads in your states land in your pipeline as they come in. Your dashboard shows your balance, leads and cost per lead."],
  ];
  const faqs: [string, React.ReactNode][] = [
    ["So, am I buying leads?", <>Yes, but not at a vendor&apos;s price. You add ad spend, and each lead is charged at what it cost us to generate, plus a {mgmtPct}% management fee. We run the ads, so you never build a campaign or spend your evenings figuring out why one stopped working.</>],
    ["What does “priced at what they actually cost” mean?", <>Most lead vendors charge one fixed price per lead, whatever it cost them to get it. Here, your price follows our real cost per lead from our Facebook campaigns, so it moves with the market by campaign, state and season. Today that works out to about $20–$40 a lead, fees included. We don&apos;t guarantee appointments, applications or issued policies. Results depend on your speed to lead, follow-up, sales process, licensing, product fit and underwriting.</>],
    ["Then what's the membership for?", <>It&apos;s your spot in the program: our live campaigns, the round robin, at-cost pricing and your advertiser dashboard. {waiver ? <>It&apos;s normally {fee} {every}, and it&apos;s waived for you as part of the {waiver.label}.</> : <>It renews at {fee} {every}.</>} Your ad spend is kept separate and is only used for leads.</>],
    ["Do I need to know anything about running ads?", <>No. We handle the campaigns, the creative and the testing.</>],
    ["How are leads shared?", <>Leads come from our Blue Collar IUL campaigns. Each one goes, in a round robin, to an advertiser licensed in the lead&apos;s state, and lands in their pipeline the moment it comes in. Nurse leads from our Essential Workers campaign work the same way for advertisers who turn them on under Lead types on their dashboard.</>],
    ["What if I cancel?", <>No more payments after the 2 weeks you&apos;ve paid for. Leads stop when that period ends, and any ad spend you haven&apos;t used stays on your account for when you rejoin.</>],
  ];

  return (
    <div>
      {banners}

      {/* Hero */}
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-b from-brand-red/[0.05] to-white px-5 py-12 text-center sm:px-10">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-red/20 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-red">
          <Megaphone className="h-3 w-3" /> Advertisely Advertiser Program
        </span>
        <h2 className="mx-auto mt-5 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          IUL leads priced at <span className="underline decoration-brand-red decoration-4 underline-offset-[6px]">what they actually cost</span>.
          <br className="hidden sm:block" /> Without running ads yourself.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
          We run the Facebook campaigns and send the leads straight to your pipeline in the states you&apos;re licensed in. As a
          member, you pay what each lead cost us to generate, plus a {mgmtPct}% management fee.
        </p>
        {waivedBadge && <div className="mx-auto mt-6 max-w-xl">{waivedBadge}</div>}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={() => scrollTo("advertise-join")}>{waiver ? "Join free" : "Join the Advertiser Program"}</Button>
          <Button size="lg" variant="outline" onClick={() => scrollTo("advertise-faq")}>How it works</Button>
        </div>
        {disclaimer}
      </section>

      {/* Why */}
      <section className="mx-auto max-w-3xl px-2 py-14 text-center">
        {eyebrow("At-cost leads")}
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Get leads without taking on a second job.</h2>
        <p className="mt-4 text-muted-foreground">
          You could pay a vendor a fixed price per lead. You could spend your nights learning Ads Manager, testing campaigns and
          trying to make them work.
        </p>
        <p className="mt-3 text-muted-foreground">
          As an Advertisely advertiser, we handle the advertising. You choose your states and how much ad spend to add.
        </p>
      </section>

      {/* Cost */}
      <section className="pb-14">
        <div className="text-center">
          {eyebrow("Pricing")}
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">What does it cost?</h2>
        </div>
        <div className="mx-auto mt-8 grid max-w-4xl gap-5 md:grid-cols-2">
          <Card className="p-6">
            <div className="text-sm font-semibold">Program membership</div>
            <div className="mt-2 flex items-baseline gap-2">
              {waiver ? (
                <>
                  <span className="text-3xl font-semibold">$0</span>
                  <span className="text-lg text-muted-foreground line-through">{fee}</span>
                  <span className="text-sm text-muted-foreground">{every}</span>
                </>
              ) : (
                <>
                  <span className="text-3xl font-semibold">{fee}</span>
                  <span className="text-sm text-muted-foreground">{every}</span>
                </>
              )}
            </div>
            {waiver && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                <BadgeCheck className="h-3.5 w-3.5" /> Waived for the {waiver.label}
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">Your membership includes:</p>
            <ul className="mt-2 space-y-2 text-sm">
              {[
                "A spot in our live Blue Collar IUL campaigns",
                "Leads shared in a round robin with advertisers licensed in the lead's state",
                `Leads at our cost + ${mgmtPct}%`,
                "Leads delivered to your Advertisely pipeline the moment they come in",
                "Your advertiser dashboard: ad spend, leads and cost per lead",
              ].map((t) => (
                <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{t}</li>
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <div className="text-sm font-semibold">Ad spend</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-semibold">You choose</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Only used as leads come in</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Your ad spend pays for your leads. Each lead costs what it cost us to generate, plus a {mgmtPct}% management fee
              and a {cardFeePct}% card processing fee. Today that&apos;s about <span className="font-medium text-foreground">$20–$40</span> a lead.
              Add more whenever you want more leads.
            </p>
          </Card>
        </div>
        <p className="mx-auto mt-5 max-w-2xl text-center text-sm text-muted-foreground">
          {waiver ? <>Your membership is waived while you&apos;re on the {waiver.label}.</> : <>Your membership renews at {fee} {every}.</>} It never buys leads: your ad spend is kept separate and is only used for leads.
        </p>
      </section>

      {/* Steps */}
      <section className="rounded-2xl bg-slate-50 px-5 py-14 sm:px-10">
        <div className="text-center">
          {eyebrow("One simple path")}
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Getting started shouldn&apos;t be a job, either.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Setup takes a few minutes and no sales call. Pick your states, join, add ad spend, and leads start coming in.
          </p>
        </div>
        <ol className="mx-auto mt-8 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold tabular-nums text-brand-red">{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-2 font-semibold">{t}</div>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Join */}
      <section id="advertise-join" className="scroll-mt-20 py-14">
        <Card className="mx-auto max-w-2xl p-6 sm:p-8">
          <h3 className="text-xl font-semibold">Join the {offer.name}</h3>
          {waivedBadge && <div className="mt-4">{waivedBadge}</div>}
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Program membership, {every}</dt>
              {waiver ? (
                <dd className="font-medium">
                  <span className="mr-1.5 font-normal text-muted-foreground line-through">{usd(offer.amountCents)}</span>
                  <span className="text-emerald-700">$0, waived</span>
                </dd>
              ) : (
                <dd className="font-medium">{usd(offer.amountCents)}</dd>
              )}
            </div>
            <div className="flex justify-between gap-4 text-muted-foreground"><dt>Ad spend</dt><dd>separate, you choose the amount</dd></div>
            <div className="flex justify-between gap-4 border-t border-slate-100 pt-1.5 font-semibold"><dt>Each lead</dt><dd>our cost + {mgmtPct}% (about $20–$40 today)</dd></div>
          </dl>

          <h4 className="mt-6 font-semibold">States you&apos;re licensed in</h4>
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

          {!waiver && (
            <div className="mt-6">
              <label htmlFor="program-promo" className="text-sm font-semibold">Promo code <span className="font-normal text-muted-foreground">(optional)</span></label>
              <input id="program-promo" type="text" value={promo} onChange={(e) => setPromo(e.target.value)} autoComplete="off" autoCapitalize="characters"
                placeholder="Enter your code"
                className="mt-1.5 block w-full sm:w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-red focus:outline-none" />
              {promo.trim() && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  We check your code when you join. Your free time shows on the checkout page before you confirm, and your card isn&apos;t charged until it ends.
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <Button size="lg" className="mt-6 w-full sm:w-auto" onClick={join} disabled={busy || states.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            {waiver ? "Join free, membership waived" : <>Join for {fee} {every}</>}
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {waiver ? (
              <>
                No card needed to join: your membership is $0 while you&apos;re on the {waiver.label}. If you leave the team, the
                regular {fee} {every} applies. After you join, add ad spend on your dashboard to start receiving leads. Each lead
                includes a {cardFeePct}% card processing fee. Cancel anytime; unused ad spend stays on your account.
              </>
            ) : (
              <>
                Billed {every} until you cancel. After you join, add ad spend on your dashboard to start receiving leads. Each lead also
                includes a {cardFeePct}% card processing fee. If you cancel, leads stop when the 2 weeks you paid for run out; unused ad
                spend stays on your account.
              </>
            )}
          </p>
        </Card>
      </section>

      {/* FAQ */}
      <section id="advertise-faq" className="scroll-mt-20 pb-6">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">FAQs</h2>
        <div className="mx-auto mt-6 max-w-3xl divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {faqs.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Button size="lg" onClick={() => scrollTo("advertise-join")}>Join the Advertiser Program</Button>
        </div>
      </section>
    </div>
  );
}
