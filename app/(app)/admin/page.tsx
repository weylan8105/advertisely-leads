"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  Users,
  ShoppingCart,
  Building2,
  Upload,
  ShieldAlert,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  CheckCheck,
  RotateCcw,
  XCircle,
  Trash2,
  Clock,
  Copy,
} from "lucide-react";
import { MetaIntegrationManager } from "@/components/admin/MetaIntegrationManager";
import { AdminImportLeadsButton } from "@/components/admin/AdminImportLeadsButton";
import { AdminAllLeads } from "@/components/admin/AdminAllLeads";
import { AdminAccounts } from "@/components/admin/AdminAccounts";
import { AdminDownlineOrders } from "@/components/admin/AdminDownlineOrders";
import { FunnelAnalytics } from "@/components/admin/FunnelAnalytics";
import { AdCostTable } from "@/components/admin/AdCostTable";
import { CreativeScorecard } from "@/components/admin/CreativeScorecard";
import { CplPanel } from "@/components/admin/CplPanel";
import { TrafficSnapshot } from "@/components/admin/TrafficSnapshot";
import { TrashQueue } from "@/components/admin/TrashQueue";
import { UserModeToggle } from "@/components/admin/UserModeToggle";

import { Input } from "@/components/ui/input";

type ReplacementStatus = "PENDING" | "APPROVED" | "DENIED";

interface Replacement {
  id: string;
  lead: string;
  phone: string;
  state: string;
  reason: string;
  agent: string;
  submitted: string;
  status: ReplacementStatus;
  awaitingFreshStock: boolean;
  autoApproved: boolean;
  undoable: boolean; // denied by mistake can be reopened (server says it's safe)
}

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}
let toastCounter = 0;

// Tabs that a notification (or any deep link) may open via ?tab=<value>.
const VALID_TABS = new Set([
  "all-leads", "meta", "sources", "funnel",
  "replacements", "accounts", "downline-orders", "trash", "stripe-sync",
]);


// Wrapped in Suspense because useSearchParams requires it during prerender.
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageInner />
    </Suspense>
  );
}

function AdminPageInner() {
  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [backedUpStates, setBackedUpStates] = useState<string[]>([]);
  const [approveAllLoading, setApproveAllLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [syncPaymentIntentId, setSyncPaymentIntentId] = useState("");
  const [syncOverrideUserId, setSyncOverrideUserId] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  // Open the tab named in ?tab= (e.g. from a notification deep link), else default.
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    const t = searchParams.get("tab");
    return t && VALID_TABS.has(t) ? t : "accounts";
  });
  // Open a tab and scroll the tab bar into view (stat cards, deep links).
  const openTab = useCallback((t: string) => {
    setTab(t);
    requestAnimationFrame(() =>
      document.getElementById("admin-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);
  // React to query changes when already on /admin (Link nav doesn't remount).
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && VALID_TABS.has(t)) openTab(t);
  }, [searchParams, openTab]);
  // Active CRM-status filter for the All-leads tab, driven by the stat cards.
  const [leadFilter, setLeadFilter] = useState("all");

  // Real data from the database (replaces the old hardcoded demo figures).
  const [stats, setStats] = useState<{
    leadsInDatabase: number;
    unassignedLeads: number;
    soldLeads: number;
    activeClientAccounts: number;
  } | null>(null);
  const [accounts, setAccounts] = useState<
    { name: string; seats: number; lifetimeSpendCents: number; lastOrder: string | null; status: string }[]
  >([]);

  const loadReplacements = useCallback(() => {
    return fetch("/api/admin/replacements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.replacements) {
          setReplacements(
            d.replacements.map((r: any) => ({
              id: r.id,
              lead: r.lead?.name ?? "—",
              phone: r.lead?.phone ?? "",
              state: r.lead?.state ?? "",
              reason: r.reason,
              agent: r.requestedBy?.name ?? r.requestedBy?.email ?? "—",
              submitted: new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
              status: r.status,
              awaitingFreshStock: !!r.awaitingFreshStock,
              autoApproved: !!r.autoApproved,
              undoable: !!r.undoable,
            })),
          );
          setBackedUpStates(d.backedUpStates ?? []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setStats(d.stats);
          setAccounts(d.accounts ?? []);
        }
      })
      .catch(() => {});

    loadReplacements();
  }, [loadReplacements]);

  const fmtNum = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

  function addToast(type: "success" | "error", message: string) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleReplacementAction(
    requestId: string,
    action: "approve" | "deny" | "undo-deny",
    leadName: string,
    force = false,
  ) {
    setLoadingId(`${requestId}-${action}`);
    try {
      const res = await fetch("/api/admin/replacements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action, force }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Order already at its 20% replacement cap: let the admin knowingly override.
        if (action === "undo-deny" && data.capExceeded && !force) {
          setLoadingId(null);
          if (window.confirm(`${data.error}\n\nUndo anyway and go over the limit for this order?`)) {
            return handleReplacementAction(requestId, action, leadName, true);
          }
          return;
        }
        addToast("error", data.error ?? `Failed to ${action} request.`);
        // The row may be stale (e.g. Undo no longer allowed) — re-sync from the server.
        await loadReplacements();
        return;
      }

      // Update local state immediately. Approve with no stock yet comes back
      // queued: stays PENDING but greenlit (autoApproved) so it auto-fills later.
      const queued = action === "approve" && data.queued === true;
      setReplacements((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? action === "undo-deny"
              ? // Back to "Pending" review: approve or deny it again from here.
                { ...r, status: "PENDING", autoApproved: false, awaitingFreshStock: false, undoable: false }
              : {
                  ...r,
                  status: action === "deny" ? "DENIED" : queued ? "PENDING" : "APPROVED",
                  autoApproved: action === "deny" ? false : queued ? true : r.autoApproved,
                  undoable: action === "deny",
                }
            : r,
        ),
      );
      addToast(
        "success",
        data.message ??
          (action === "undo-deny"
            ? `${leadName}'s denial was undone — back in the queue for review.`
            : `${leadName}'s replacement request ${action === "approve" ? "approved" : "denied"}.`),
      );
    } catch {
      addToast("error", `Failed to ${action} request. Please try again.`);
    } finally {
      setLoadingId(null);
    }
  }

  // Greenlight every un-reviewed pending request at once: delivers the ones with
  // fresh stock now, queues the rest to auto-fulfill when a fresh lead arrives.
  async function handleApproveAll() {
    setApproveAllLoading(true);
    try {
      const res = await fetch("/api/admin/replacements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-all" }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast("error", data.error ?? "Failed to approve pending requests.");
        return;
      }
      await loadReplacements();
      addToast("success", data.message ?? "Pending requests approved.");
    } catch {
      addToast("error", "Failed to approve pending requests. Please try again.");
    } finally {
      setApproveAllLoading(false);
    }
  }

  const pendingUnreviewed = replacements.filter((r) => r.status === "PENDING" && !r.autoApproved).length;

  return (
    <div>
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg bg-white ${
                t.type === "success"
                  ? "border-emerald-200 text-emerald-800"
                  : "border-rose-200 text-rose-800"
              }`}
            >
              {t.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-rose-600" />
              )}
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismissToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <PageHeader
        eyebrow="Internal · Advertisely Admin"
        title="Operations console"
        description="Manage the entire lead pipeline — inbound from Meta, dispersal to agents, replacement queue, and source attribution."
        actions={
          <>
            <UserModeToggle />
            <AdminImportLeadsButton />
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => { setLeadFilter("all"); setTab("all-leads"); }}
          className="text-left transition-transform hover:-translate-y-0.5"
          title="Show every lead in the database"
        >
          <DashboardStatCard
            label="Leads in database"
            value={stats ? fmtNum(stats.leadsInDatabase) : "—"}
            hint="click to view all"
            accent="teal"
            icon={<Database className="h-4 w-4" />}
            selected={tab === "all-leads" && leadFilter === "all"}
          />
        </button>
        <button
          onClick={() => { setLeadFilter("unassigned"); setTab("all-leads"); }}
          className="text-left transition-transform hover:-translate-y-0.5"
          title="Filter to leads not in a CRM"
        >
          <DashboardStatCard
            label="Unassigned leads"
            value={stats ? fmtNum(stats.unassignedLeads) : "—"}
            hint="click to filter"
            accent="amber"
            icon={<ShieldAlert className="h-4 w-4" />}
            selected={tab === "all-leads" && leadFilter === "unassigned"}
          />
        </button>
        <button
          onClick={() => { setLeadFilter("assigned"); setTab("all-leads"); }}
          className="text-left transition-transform hover:-translate-y-0.5"
          title="Filter to sold / in-CRM leads"
        >
          <DashboardStatCard
            label="Sold leads"
            value={stats ? fmtNum(stats.soldLeads) : "—"}
            hint="click to filter"
            accent="violet"
            icon={<ShoppingCart className="h-4 w-4" />}
            selected={tab === "all-leads" && leadFilter === "assigned"}
          />
        </button>
        <button
          onClick={() => openTab("accounts")}
          className="text-left transition-transform hover:-translate-y-0.5"
          title="See client accounts + conversion"
        >
          <DashboardStatCard
            label="Active client accounts"
            value={stats ? fmtNum(stats.activeClientAccounts) : "—"}
            hint="paying agents · click to view"
            accent="emerald"
            icon={<Building2 className="h-4 w-4" />}
            selected={tab === "accounts"}
          />
        </button>
      </div>

      {/* Always-visible live landing-page traffic — deep-links to the full funnel tab */}
      <TrafficSnapshot
        onOpenFunnel={() => {
          openTab("funnel");
        }}
      />

      <div id="admin-tabs" className="mt-6 scroll-mt-4">
        <Tabs value={tab} onValueChange={setTab}>
          {/* Scroll the long tab bar horizontally on mobile instead of overflowing. */}
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-thin">
          <TabsList className="w-max">
            <TabsTrigger value="accounts">Client accounts</TabsTrigger>
            <TabsTrigger value="replacements">
              Replacement Queue
              {/* Only requests that need YOU to act (pending, not yet reviewed). */}
              {pendingUnreviewed > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-brand-red text-white text-[10px] h-4 min-w-[16px] px-1">
                  {pendingUnreviewed}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="all-leads">Lead database</TabsTrigger>
            <TabsTrigger value="meta">Meta ingestion</TabsTrigger>
            <TabsTrigger value="sources">CPL price floor</TabsTrigger>
            <TabsTrigger value="funnel">Funnel analytics</TabsTrigger>
            <TabsTrigger value="downline-orders">Downline orders</TabsTrigger>
            <TabsTrigger value="trash">Trash</TabsTrigger>
            <TabsTrigger value="stripe-sync">Stripe sync</TabsTrigger>
          </TabsList>
          </div>

          <TabsContent value="accounts">
            <Card>
              <CardHeader>
                <CardTitle>Client accounts</CardTitle>
              </CardHeader>
              <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Every client account, open orders first. Manage their lead orders or open their CRM.
              </p>
              <AdminAccounts />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="replacements">
            <Card>
              <CardHeader>
                <CardTitle>Replacement Queue</CardTitle>
              </CardHeader>
              <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Review replacement requests submitted by agents. Approve, deny, or undo a denial.
                Approved requests auto-fill as fresh leads arrive in their states.
              </p>
                {pendingUnreviewed > 0 && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5">
                    <span className="text-sm text-emerald-900">
                      <strong>{pendingUnreviewed}</strong> request{pendingUnreviewed === 1 ? "" : "s"} awaiting
                      review. Approving greenlights them — in-stock ones deliver now, the rest auto-fill
                      when a fresh lead arrives.
                    </span>
                    <Button
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={approveAllLoading || !!loadingId}
                      onClick={handleApproveAll}
                    >
                      {approveAllLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCheck className="h-3.5 w-3.5" />
                      )}
                      Approve all pending ({pendingUnreviewed})
                    </Button>
                  </div>
                )}
                {backedUpStates.length > 0 && (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                    <Clock className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                    <span>
                      Waiting on fresh stock in{" "}
                      <strong>{backedUpStates.join(", ")}</strong>. These requests fill automatically
                      once a fresh (&lt;48h) lead comes in for that state — no action needed.
                    </span>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="hidden md:table-cell">Agent</TableHead>
                      <TableHead className="hidden md:table-cell">Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {replacements.map((r) => {
                      const isPending = r.status === "PENDING";
                      const queued = isPending && r.autoApproved; // approved, awaiting fresh stock
                      const approveLoading = loadingId === `${r.id}-approve`;
                      const denyLoading = loadingId === `${r.id}-deny`;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {r.lead}
                            {r.state && (
                              <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-600">
                                {r.state}
                              </span>
                            )}
                            {r.phone && (
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <a
                                  href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
                                  className="text-xs font-normal text-brand-red hover:underline"
                                  title="Call to verify the number"
                                >
                                  {r.phone}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard
                                      .writeText(r.phone)
                                      .then(() => addToast("success", "Number copied"))
                                      .catch(() => addToast("error", "Couldn't copy number"));
                                  }}
                                  title="Copy number"
                                  aria-label="Copy number"
                                  className="text-slate-400 transition-colors hover:text-slate-600"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{r.reason}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {r.agent}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {r.submitted}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <Badge
                                variant={
                                  r.status === "APPROVED"
                                    ? "success"
                                    : r.status === "DENIED"
                                    ? "destructive"
                                    : queued
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {r.status === "APPROVED"
                                  ? "Approved"
                                  : r.status === "DENIED"
                                  ? "Denied"
                                  : queued
                                  ? "Approved"
                                  : "Pending"}
                              </Badge>
                              {queued && r.awaitingFreshStock && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                  <Clock className="h-3 w-3" /> Waiting on fresh stock
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {isPending ? (
                              <div className="inline-flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                  disabled={!!loadingId}
                                  onClick={() => handleReplacementAction(r.id, "deny", r.lead)}
                                  title={queued ? "Cancel this approval" : "Deny this request"}
                                >
                                  {denyLoading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <XCircle className="h-3.5 w-3.5" />
                                  )}
                                  {queued ? "Cancel" : "Deny"}
                                </Button>
                                {!queued && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                    disabled={!!loadingId}
                                    onClick={() => handleReplacementAction(r.id, "approve", r.lead)}
                                  >
                                    {approveLoading ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <CheckCheck className="h-3.5 w-3.5" />
                                    )}
                                    Approve
                                  </Button>
                                )}
                              </div>
                            ) : r.status === "DENIED" && r.undoable ? (
                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-muted-foreground italic">Denied</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                                  disabled={!!loadingId}
                                  onClick={() => handleReplacementAction(r.id, "undo-deny", r.lead)}
                                  title="Undo this denial — puts the request back in the queue for review"
                                >
                                  {loadingId === `${r.id}-undo-deny` ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                  Undo
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">
                                {r.status === "APPROVED" ? "Approved" : "Denied"}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="all-leads">
            <Card>
              <CardHeader>
                <CardTitle>Lead database</CardTitle>
                <CardDescription>
                  Every lead in the system — assigned or not. Search and filter to verify
                  exactly what has come in from Meta and where it went.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AdminAllLeads assigned={leadFilter} onAssignedChange={setLeadFilter} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="meta">
            <MetaIntegrationManager />
          </TabsContent>

          <TabsContent value="sources">
            <CplPanel />
          </TabsContent>


          <TabsContent value="stripe-sync">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-brand-red" />
                  Recover missing Stripe order
                </CardTitle>
                <CardDescription>
                  If a payment went through but the order didn&apos;t appear (webhook missed), paste the
                  Stripe PaymentIntent ID here to manually sync it into the database.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <strong>How to find the PaymentIntent ID:</strong> Go to{" "}
                  <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noopener noreferrer" className="underline">Stripe Dashboard → Payments</a>,
                  click the payment, and copy the ID starting with <code className="font-mono">pi_</code>.
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">PaymentIntent ID <span className="text-brand-red">*</span></label>
                    <Input
                      placeholder="pi_3ABC..."
                      value={syncPaymentIntentId}
                      onChange={(e) => setSyncPaymentIntentId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Override User ID <span className="text-muted-foreground text-xs">(only if metadata is missing)</span></label>
                    <Input
                      placeholder="cuid or uuid from DB"
                      value={syncOverrideUserId}
                      onChange={(e) => setSyncOverrideUserId(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  disabled={!syncPaymentIntentId || syncLoading}
                  onClick={async () => {
                    setSyncLoading(true);
                    setSyncResult(null);
                    try {
                      const method = syncOverrideUserId ? "PUT" : "POST";
                      const body: any = { paymentIntentId: syncPaymentIntentId };
                      if (syncOverrideUserId) body.overrideUserId = syncOverrideUserId;
                      const res = await fetch("/api/admin/sync-order", {
                        method,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                      });
                      const data = await res.json();
                      setSyncResult({ ok: res.ok, ...data });
                      if (res.ok) {
                        addToast("success", data.message ?? "Order synced successfully!");
                      } else {
                        addToast("error", data.error ?? "Sync failed.");
                      }
                    } catch {
                      addToast("error", "Network error — sync failed.");
                    } finally {
                      setSyncLoading(false);
                    }
                  }}
                >
                  {syncLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  {syncLoading ? "Syncing..." : "Sync order"}
                </Button>
                {syncResult && (
                  <div className={`rounded-lg border p-4 text-sm font-mono whitespace-pre-wrap ${
                    syncResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
                  }`}>
                    {JSON.stringify(syncResult, null, 2)}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="downline-orders">
            <Card>
              <CardHeader>
                <CardTitle>Orders placed for a downline</CardTitle>
                <CardDescription>
                  Orders one account placed for a downline agent, platform-wide. The leads deliver to the
                  downline agent&apos;s pipeline, not the buyer&apos;s.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AdminDownlineOrders />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trash">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-rose-500" />
                  Trash (recycle bin)
                </CardTitle>
                <CardDescription>
                  Replaced and bad leads land here. They are never sold and are automatically
                  deleted 30 days after being trashed. Restore one to return it to the pool.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TrashQueue />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="funnel">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Creative scorecard</CardTitle>
                <CardDescription>
                  Every ad across ABCA, Enhanced Wealth and HWA, ranked by what its leads turned into: applications,
                  Issued PAID deals and premium, next to what the ad cost.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CreativeScorecard />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Real cost per lead by ad</CardTitle>
                <CardDescription>
                  What each blue-collar ad actually costs per lead that reached your system, next to what Meta reports.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AdCostTable />
              </CardContent>
            </Card>
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Landing page funnel</CardTitle>
                <CardDescription>
                  Click-through and step-by-step drop-off on the ABCA quiz funnel — see where visitors
                  leave so we know what to improve.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FunnelAnalytics />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
