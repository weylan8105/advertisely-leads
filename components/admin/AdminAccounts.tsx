"use client";

import { useEffect, useState } from "react";
import { Loader2, X, ArrowRight, Search, Users, Package, Repeat, RefreshCw, Megaphone, Link2 as LinkIcon, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PipelineBoard } from "@/components/leads/PipelineBoard";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ClientOrdersModal } from "@/components/admin/ClientOrdersModal";
import { ViewAsClientButton } from "@/components/admin/ViewAsClient";
import { matchesWords, searchWords } from "@/lib/leadSearch";
import type { Lead } from "@/types";

interface Account {
  userId: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  agency: string | null;
  delivered: number;
  byStage: Record<string, number>;
  sold: number;
  apCents: number;
  leadSpendCents: number;
  lastOrderAt: string | null;
  hasOrder: boolean;
  joinedAt: string | null;
  conversionPct: number;
  orderedQty: number;
  fulfilledQty: number;
  orderProgressPct: number;
  subscription: {
    status: string;
    weeklyCents: number;
    leadsPerWeek: number;
    deliveredThisWeek: number;
    progressPct: number;
  } | null;
  isAdvertiser: boolean;
  ringyConnected: boolean;
}

/** Which kind of account this is — drives the segment filter + badge. */
type Segment = "advertisers" | "subs" | "orders";
function segmentOf(a: Account): Segment | null {
  if (a.isAdvertiser) return "advertisers";
  if (a.subscription) return "subs";
  // Signed up but never ordered: only listed under All.
  if (!a.hasOrder && a.role !== "ADMIN") return null;
  return "orders";
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
  const [managing, setManaging] = useState<Account | null>(null);
  const [ringyFor, setRingyFor] = useState<Account | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [segment, setSegment] = useState<"all" | Segment>("all");
  const [search, setSearch] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [advEmail, setAdvEmail] = useState("");
  const [addingAdv, setAddingAdv] = useState(false);
  const [advMsg, setAdvMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Advertiser invite link — anyone who signs up through it becomes an advertiser.
  const [inviteCopied, setInviteCopied] = useState(false);
  async function copyAdvertiserInvite() {
    try {
      const res = await fetch("/api/admin/advertiser-invite");
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || `HTTP ${res.status}`);
      try {
        await navigator.clipboard.writeText(d.url);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2000);
      } catch {
        window.prompt("Copy the advertiser invite link:", d.url);
      }
    } catch (e: any) {
      window.alert(e?.message ?? "Couldn't get the invite link.");
    }
  }

  // Mark any account an advertiser by email, without hunting for its row in the
  // list.
  async function addAdvertiser() {
    const email = advEmail.trim();
    if (!email) return;
    setAddingAdv(true);
    setAdvMsg(null);
    try {
      const res = await fetch("/api/admin/accounts/advertiser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, isAdvertiser: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setAdvMsg({ ok: true, text: `${email} is now an advertiser.` });
      setAdvEmail("");
      setSegment("advertisers");
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      setAdvMsg({ ok: false, text: e?.message ?? "Couldn't mark that account." });
    } finally {
      setAddingAdv(false);
    }
  }

  async function toggleAdvertiser(a: Account) {
    const next = !a.isAdvertiser;
    if (!next && !window.confirm(`Remove advertiser status from ${a.name ?? a.email}? They'll move back to Lead orders / Subscriptions and lose the all-50-states exemption.`)) return;
    setTogglingId(a.userId);
    // Optimistic — flip locally so the badge/segment update immediately.
    setAccounts((prev) => prev?.map((x) => (x.userId === a.userId ? { ...x, isAdvertiser: next } : x)) ?? prev);
    try {
      const res = await fetch("/api/admin/accounts/advertiser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: a.userId, isAdvertiser: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    } catch (e: any) {
      // Roll back on failure.
      setAccounts((prev) => prev?.map((x) => (x.userId === a.userId ? { ...x, isAdvertiser: a.isAdvertiser } : x)) ?? prev);
      window.alert(e?.message ?? "Couldn't update advertiser status.");
    } finally {
      setTogglingId(null);
    }
  }

  async function reconcileSubscriptions() {
    if (!window.confirm("Reconcile subscriptions with Stripe? This creates any missing weekly lead orders from paid invoices.")) return;
    setReconciling(true);
    setReconcileMsg(null);
    try {
      const res = await fetch("/api/admin/subscriptions/reconcile", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setReconcileMsg({
        ok: true,
        text: `${d.ordersCreated ?? 0} weekly order${(d.ordersCreated ?? 0) === 1 ? "" : "s"} created across ${d.subscriptions ?? 0} subscription${(d.subscriptions ?? 0) === 1 ? "" : "s"}.`,
      });
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      setReconcileMsg({ ok: false, text: e?.message ?? "Reconcile failed." });
    } finally {
      setReconciling(false);
    }
  }

  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setAccounts(d.accounts ?? []))
      .catch((e) => setError(e.message));
  }, [reloadKey]);

  if (error) return <div className="text-rose-600 text-sm py-8 text-center">Couldn&apos;t load accounts: {error}</div>;
  if (!accounts)
    return (
      <div className="flex items-center gap-2 justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
      </div>
    );

  const countsOf = (list: Account[]) => ({
    all: list.length,
    orders: list.filter((a) => segmentOf(a) === "orders").length,
    subs: list.filter((a) => segmentOf(a) === "subs").length,
    advertisers: list.filter((a) => segmentOf(a) === "advertisers").length,
  });
  const counts = countsOf(accounts);
  // Search by name, phone or email. The tab counts follow it, so a match on
  // another tab still shows up.
  const words = searchWords(search);
  const matched = accounts.filter((a) => matchesWords(words, [a.name, a.email].filter(Boolean).join(" "), a.phone));
  const tabCounts = countsOf(matched);
  const filtered = segment === "all" ? matched : matched.filter((a) => segmentOf(a) === segment);

  const SEGMENTS: { key: "all" | Segment; label: string }[] = [
    { key: "all", label: "All" },
    { key: "orders", label: "Lead orders" },
    { key: "subs", label: "Subscriptions" },
    { key: "advertisers", label: "Advertisers" },
  ];

  return (
    <>
      {/* Segment the box into the three account types: one-off lead-order buyers,
          weekly subscribers, and advertisers (exclusive owner-delivery). */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors inline-flex items-center gap-1.5",
                segment === s.key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.key === "subs" && <Repeat className="h-3 w-3" />}
              {s.key === "advertisers" && <Megaphone className="h-3 w-3" />}
              {s.label}
              <span className="tabular-nums opacity-60">{tabCounts[s.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }}
            placeholder="Search name, phone, email…"
            aria-label="Search client accounts"
            className="h-8 w-full rounded-full border border-slate-200 bg-white pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:border-brand-red/50 focus:outline-none focus:ring-2 focus:ring-brand-red/15"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search"
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-slate-100 hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {counts.subs > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5 text-brand-red" />
              {counts.subs} active subscription{counts.subs === 1 ? "" : "s"}
            </span>
          ) : (
            "No active subscriptions"
          )}
          {counts.advertisers > 0 && (
            <span className="inline-flex items-center gap-1.5 ml-3">
              <Megaphone className="h-3.5 w-3.5 text-sky-600" />
              {counts.advertisers} advertiser{counts.advertisers === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {advMsg && (
            <span className={cn("text-[11px]", advMsg.ok ? "text-emerald-600" : "text-rose-600")}>{advMsg.text}</span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={copyAdvertiserInvite}
            title="Anyone who creates an account through this link is set up as an advertiser"
          >
            {inviteCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {inviteCopied ? "Link copied" : "Copy advertiser invite link"}
          </Button>
          <form
            onSubmit={(e) => { e.preventDefault(); void addAdvertiser(); }}
            className="flex items-center gap-1.5"
          >
            <input
              type="email"
              value={advEmail}
              onChange={(e) => setAdvEmail(e.target.value)}
              placeholder="Account email"
              className="h-8 w-48 rounded-md border border-slate-200 px-2.5 text-xs focus:border-brand-red focus:outline-none"
            />
            <Button size="sm" variant="outline" type="submit" disabled={addingAdv || !advEmail.trim()}>
              {addingAdv ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
              Add advertiser
            </Button>
          </form>
          {reconcileMsg && (
            <span className={cn("text-[11px]", reconcileMsg.ok ? "text-emerald-600" : "text-rose-600")}>{reconcileMsg.text}</span>
          )}
          <Button size="sm" variant="outline" onClick={reconcileSubscriptions} disabled={reconciling}>
            {reconciling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reconcile subscriptions
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-slate-200">
              <th className="text-left py-2 font-medium">Account</th>
              <th className="text-left py-2 font-medium">Order progress</th>
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
            {filtered.map((a) => {
              const m = metrics(a);
              return (
                <tr key={a.userId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5">
                    <div className="font-medium flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-brand-red shrink-0" />
                      {a.name ?? a.email.split("@")[0]}
                      {a.role === "ADMIN" && <Badge variant="muted" className="text-[9px]">Admin</Badge>}
                      {a.subscription && (
                        <Badge
                          variant="muted"
                          className={cn(
                            "text-[9px] inline-flex items-center gap-0.5",
                            a.subscription.status === "active"
                              ? "border-brand-red/20 bg-brand-red/5 text-brand-red"
                              : "border-amber-200 bg-amber-50 text-amber-700",
                          )}
                          title={`Weekly subscription · ${a.subscription.status}`}
                        >
                          <Repeat className="h-2.5 w-2.5" /> Sub
                        </Badge>
                      )}
                      {a.isAdvertiser && (
                        <Badge
                          variant="muted"
                          className="text-[9px] inline-flex items-center gap-0.5 border-sky-200 bg-sky-50 text-sky-700"
                          title="Advertiser — runs their own campaign; receives their leads exclusively"
                        >
                          <Megaphone className="h-2.5 w-2.5" /> Advertiser
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{a.email}{a.agency ? ` · ${a.agency}` : ""}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.phone ? (
                        <a href={`tel:${a.phone.replace(/[^\d+]/g, "")}`} className="hover:text-foreground hover:underline">
                          {a.phone}
                        </a>
                      ) : (
                        <span className="italic text-slate-400">No phone on file</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5">
                    {a.subscription ? (
                      // Subscribers get ONE bar — a distinct weekly "this week"
                      // bar (indigo), never the one-off order bar. Manage orders
                      // still shows any individual orders they've placed.
                      <div className="w-32" title={`Weekly subscription — ${a.subscription.deliveredThisWeek} of ${a.subscription.leadsPerWeek} leads delivered this billing week`}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="inline-flex items-center gap-1 font-medium text-indigo-600">
                            <Repeat className="h-3 w-3" /> Subscription
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {a.subscription.deliveredThisWeek}/{a.subscription.leadsPerWeek}
                            <span className="opacity-60"> wk</span>
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                            style={{ width: `${a.subscription.progressPct}%` }}
                          />
                        </div>
                      </div>
                    ) : a.orderedQty > 0 ? (
                      <div className="w-32">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="tabular-nums font-medium text-foreground">
                            {a.fulfilledQty}/{a.orderedQty}
                          </span>
                          <span
                            className={cn(
                              "tabular-nums",
                              a.orderProgressPct >= 100 ? "text-emerald-600 font-medium" : "text-muted-foreground",
                            )}
                          >
                            {a.orderProgressPct >= 100 ? "Complete" : `${a.orderProgressPct}%`}
                          </span>
                        </div>
                        <Progress value={a.orderProgressPct} className="h-1.5" />
                      </div>
                    ) : a.isAdvertiser ? (
                      // Advertisers don't buy orders — their leads arrive via
                      // exclusive owner-delivery, so show that instead of a bar.
                      <div className="text-[11px]" title="Receives their own campaign's leads exclusively">
                        <span className="inline-flex items-center gap-1 font-medium text-sky-600">
                          <Megaphone className="h-3 w-3" /> Advertiser
                        </span>
                        <div className="text-muted-foreground tabular-nums">{a.delivered} exclusive lead{a.delivered === 1 ? "" : "s"}</div>
                        <button
                          onClick={() => setRingyFor(a)}
                          className={cn(
                            "mt-0.5 inline-flex items-center gap-1 hover:underline",
                            a.ringyConnected ? "text-emerald-600" : "text-muted-foreground hover:text-foreground",
                          )}
                          title={a.ringyConnected ? "Ringy CRM connected — leads forward automatically. Click to manage." : "Forward this advertiser's leads into their Ringy CRM"}
                        >
                          <LinkIcon className="h-2.5 w-2.5" />
                          {a.ringyConnected ? "Ringy ✓" : "Link Ringy"}
                        </button>
                      </div>
                    ) : a.hasOrder || !a.joinedAt ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="text-[11px] text-muted-foreground">
                        <div className="font-medium">No orders yet</div>
                        <div>Joined {formatDate(a.joinedAt)}</div>
                      </div>
                    )}
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
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" onClick={() => setManaging(a)}>
                        <Package className="h-3.5 w-3.5" /> Manage orders
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setViewing(a)}>
                        View CRM <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                      <ViewAsClientButton userId={a.userId} label={a.name ?? a.email} />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleAdvertiser(a)}
                        disabled={togglingId === a.userId}
                        title={
                          a.isAdvertiser
                            ? "Remove advertiser status"
                            : "Mark as advertiser — exclusive owner-delivery + all-50-states exemption"
                        }
                        className={cn(
                          a.isAdvertiser ? "text-sky-600 hover:text-sky-700" : "text-muted-foreground",
                        )}
                      >
                        {togglingId === a.userId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Megaphone className="h-3.5 w-3.5" />
                        )}
                        {a.isAdvertiser ? "Advertiser ✓" : "Make advertiser"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-sm text-muted-foreground py-10">
                  {words.length
                    ? "No accounts match that search."
                    : segment === "advertisers"
                    ? "No advertiser accounts yet."
                    : segment === "subs"
                      ? "No subscription accounts yet."
                      : segment === "orders"
                        ? "No lead-order accounts yet."
                        : "No client accounts yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-indigo-600"><Repeat className="h-3 w-3" /> Subscription</span> (indigo) = leads delivered this billing week ÷ the subscription&apos;s weekly allotment · Order progress (red) = leads delivered ÷ leads ordered across open (incomplete) orders, for non-subscription accounts · Working = leads moved past intake · Quoted = presentation/underwriting/approved · Conv. = policies sold ÷ delivered.
        <span className="font-medium">Manage orders</span> to change an order&apos;s states, quantity, or close/reopen it; <span className="font-medium">View CRM</span> to see their full pipeline; <span className="font-medium">View dashboard</span> to see their whole app exactly as they do (view only, nothing you click there changes their account).
      </p>

      {ringyFor && (
        <RingyModal
          account={ringyFor}
          onClose={(changed) => { setRingyFor(null); if (changed) setReloadKey((k) => k + 1); }}
        />
      )}
      {viewing && <AccountBoardModal account={viewing} onClose={() => setViewing(null)} />}
      {managing && (
        <ClientOrdersModal
          account={managing}
          onClose={(changed) => { setManaging(null); if (changed) setReloadKey((k) => k + 1); }}
        />
      )}
    </>
  );
}

function RingyModal({ account, onClose }: { account: Account; onClose: (changed: boolean) => void }) {
  const [sid, setSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!sid.trim() || !authToken.trim()) { setErr("Both the SID and Auth Token are required."); return; }
    setBusy("save"); setErr(null);
    try {
      const res = await fetch("/api/admin/accounts/ringy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.userId, sid: sid.trim(), authToken: authToken.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      onClose(true);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't save."); setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect Ringy for ${account.name ?? account.email}? New leads will stop forwarding to their Ringy CRM.`)) return;
    setBusy("disconnect"); setErr(null);
    try {
      const res = await fetch("/api/admin/accounts/ringy", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.userId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      onClose(true);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't disconnect."); setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => onClose(false)} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-1.5">
              <LinkIcon className="h-4 w-4 text-sky-600" /> Ringy CRM — {account.name ?? account.email}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Every lead delivered to this advertiser will also be POSTed into their Ringy account.
            </p>
          </div>
          <button onClick={() => onClose(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {account.ringyConnected && (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
              Ringy is connected. Enter new keys below to replace them, or disconnect.
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-foreground">SID</label>
            <input
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              placeholder="Ringy API SID"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground">Auth Token</label>
            <input
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Ringy API Auth Token"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex items-center justify-between pt-1">
            {account.ringyConnected ? (
              <Button size="sm" variant="outline" onClick={disconnect} disabled={!!busy} className="text-rose-600 hover:text-rose-700">
                {busy === "disconnect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Disconnect
              </Button>
            ) : <span />}
            <Button size="sm" onClick={save} disabled={!!busy}>
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {account.ringyConnected ? "Replace keys" : "Connect Ringy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
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
            <PipelineBoard leads={leads} setLeads={setLeads} showWorkers={false} />
          )}
        </div>
      </div>
    </div>
  );
}
