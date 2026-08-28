"use client";

import { useState, useEffect } from "react";
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
import { Progress } from "@/components/ui/progress";
import {
  Database,
  Users,
  ShoppingCart,
  Building2,
  Upload,
  Sparkles,
  ShieldAlert,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  CheckCheck,
  XCircle,
} from "lucide-react";
import { AdminLeadQueue } from "@/components/admin/AdminLeadQueue";
import { MetaIntegrationManager } from "@/components/admin/MetaIntegrationManager";
import { AdminImportLeadsButton } from "@/components/admin/AdminImportLeadsButton";
import { AdminAllLeads } from "@/components/admin/AdminAllLeads";
import { AssignToMeCard } from "@/components/admin/AssignToMeCard";
import { AdminAccounts } from "@/components/admin/AdminAccounts";

import { formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type ReplacementStatus = "PENDING" | "APPROVED" | "DENIED";

interface Replacement {
  id: string;
  lead: string;
  reason: string;
  agent: string;
  submitted: string;
  status: ReplacementStatus;
}

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}
let toastCounter = 0;

export default function AdminPage() {
  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [syncPaymentIntentId, setSyncPaymentIntentId] = useState("");
  const [syncOverrideUserId, setSyncOverrideUserId] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [tab, setTab] = useState("all-leads");

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

    fetch("/api/admin/replacements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.replacements) {
          setReplacements(
            d.replacements.map((r: any) => ({
              id: r.id,
              lead: r.lead?.name ?? "—",
              reason: r.reason,
              agent: r.requestedBy?.name ?? r.requestedBy?.email ?? "—",
              submitted: new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
              status: r.status,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

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
    action: "approve" | "deny",
    leadName: string,
  ) {
    setLoadingId(`${requestId}-${action}`);
    try {
      const res = await fetch("/api/admin/replacements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const data = await res.json();

      if (!res.ok) {
        addToast("error", data.error ?? `Failed to ${action} request.`);
        return;
      }

      // Update local state immediately
      setReplacements((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? { ...r, status: action === "approve" ? "APPROVED" : "DENIED" }
            : r,
        ),
      );
      addToast(
        "success",
        `${leadName}'s replacement request ${action === "approve" ? "approved" : "denied"}.`,
      );
    } catch {
      addToast("error", `Failed to ${action} request. Please try again.`);
    } finally {
      setLoadingId(null);
    }
  }

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
            <AdminImportLeadsButton />
            <Button size="sm">
              <Sparkles className="h-4 w-4" /> Open auto-distribution
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardStatCard
          label="Leads in database"
          value={stats ? fmtNum(stats.leadsInDatabase) : "—"}
          delta={9.4}
          hint="last 30 days"
          accent="teal"
          icon={<Database className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Unassigned leads"
          value={stats ? fmtNum(stats.unassignedLeads) : "—"}
          delta={-3.1}
          hint="pending dispersal"
          accent="amber"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Sold leads"
          value={stats ? fmtNum(stats.soldLeads) : "—"}
          delta={12.6}
          hint="last 30 days"
          accent="violet"
          icon={<ShoppingCart className="h-4 w-4" />}
        />
        <button
          onClick={() => setTab("accounts")}
          className="text-left transition-transform hover:-translate-y-0.5"
          title="See client accounts + conversion"
        >
          <DashboardStatCard
            label="Active client accounts"
            value={stats ? fmtNum(stats.activeClientAccounts) : "—"}
            delta={6.0}
            hint="paying agents · click to view"
            accent="emerald"
            icon={<Building2 className="h-4 w-4" />}
          />
        </button>
      </div>

      <AssignToMeCard />

      <div className="mt-8">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all-leads">All leads</TabsTrigger>
            <TabsTrigger value="queue">Manual assignment</TabsTrigger>
            <TabsTrigger value="meta">Meta ingestion</TabsTrigger>
            <TabsTrigger value="auto">Auto-distribution</TabsTrigger>
            <TabsTrigger value="sources">Sources & campaigns</TabsTrigger>
            <TabsTrigger value="replacements">
              Replacement queue
              {replacements.filter((r) => r.status === "PENDING").length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-brand-red text-white text-[10px] h-4 min-w-[16px] px-1">
                  {replacements.filter((r) => r.status === "PENDING").length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="accounts">Client accounts</TabsTrigger>
            <TabsTrigger value="stripe-sync">Stripe sync</TabsTrigger>
          </TabsList>

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
                <AdminAllLeads />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="queue">
            <Card>
              <CardHeader>
                <CardTitle>Manual lead dispersal</CardTitle>
                <CardDescription>
                  Assign unassigned inbound leads to agents. New leads land here from Meta ad
                  campaigns the moment they opt in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AdminLeadQueue />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="meta">
            <MetaIntegrationManager />
          </TabsContent>

          <TabsContent value="auto">
            <Card>
              <CardHeader>
                <CardTitle>Auto-distribution queue</CardTitle>
                <CardDescription>
                  Future-ready system. Define rules to route new leads to agents by state,
                  niche, package subscription, or round-robin.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <Sparkles className="h-7 w-7 mx-auto text-brand-red" />
                  <h3 className="mt-3 font-medium">Auto-distribution engine coming online</h3>
                  <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
                    When enabled, every new inbound IUL lead is routed to the right agent
                    automatically based on geography, niche, and active order quotas.
                  </p>
                  <Badge className="mt-4" variant="purple">
                    Roadmap · Q3
                  </Badge>
                </div>
                <div className="mt-6 grid md:grid-cols-3 gap-4">
                  {[
                    { title: "Routing rules", body: "State, age, niche, agency seat, round-robin, weighted by order quota." },
                    { title: "Throttling", body: "Daily caps per agent. Pause when CRM reports no pickup." },
                    { title: "Failover", body: "Unrouted leads fall back to manual queue automatically." },
                  ].map((c) => (
                    <div key={c.title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-medium">{c.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{c.body}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sources">
            <Card>
              <CardHeader>
                <CardTitle>Campaign & source tracking</CardTitle>
                <CardDescription>
                  Live performance of Meta campaigns feeding the IUL pipeline.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campaign</TableHead>
                        <TableHead className="hidden md:table-cell">Spend (30d)</TableHead>
                        <TableHead className="hidden md:table-cell">Leads</TableHead>
                        <TableHead className="hidden md:table-cell">CPL</TableHead>
                        <TableHead>Quality</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {["Facebook — IUL Blue Collar", "Facebook — FIA Retirement", "Instagram — Final Expense", "Facebook — IUL Age 35-45", "Instagram — IUL Women", "Facebook — FIA Midwest", "Google — Retirement Planning", "Facebook — Final Expense Senior"].slice(0, 8).map((s, i) => {
                        const spend = 1200 + i * 380;
                        const leads = 32 + i * 7;
                        const cpl = spend / leads;
                        const q = 72 + ((i * 13) % 22);
                        return (
                          <TableRow key={s}>
                            <TableCell className="text-sm">{s}</TableCell>
                            <TableCell className="hidden md:table-cell">{formatCurrency(spend)}</TableCell>
                            <TableCell className="hidden md:table-cell">{leads}</TableCell>
                            <TableCell className="hidden md:table-cell">{formatCurrency(cpl)}</TableCell>
                            <TableCell className="min-w-[140px]">
                              <div className="flex items-center gap-2">
                                <Progress value={q} className="h-1.5 max-w-[80px]" />
                                <span className="text-xs text-muted-foreground">{q}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={q > 80 ? "success" : q > 70 ? "info" : "warning"}>
                                {q > 80 ? "Strong" : q > 70 ? "Healthy" : "Watch"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="replacements">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-brand-red" />
                  Quality & replacement queue
                </CardTitle>
                <CardDescription>
                  Review replacement requests submitted by agents. Approve, deny, or escalate.
                </CardDescription>
              </CardHeader>
              <CardContent>
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
                      const approveLoading = loadingId === `${r.id}-approve`;
                      const denyLoading = loadingId === `${r.id}-deny`;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.lead}</TableCell>
                          <TableCell className="text-sm">{r.reason}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {r.agent}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {r.submitted}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                r.status === "APPROVED"
                                  ? "success"
                                  : r.status === "DENIED"
                                  ? "destructive"
                                  : "warning"
                              }
                            >
                              {r.status === "APPROVED" ? "Approved" : r.status === "DENIED" ? "Denied" : "Pending"}
                            </Badge>
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
                                >
                                  {denyLoading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <XCircle className="h-3.5 w-3.5" />
                                  )}
                                  Deny
                                </Button>
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

          <TabsContent value="accounts">
            <Card>
              <CardHeader>
                <CardTitle>Client accounts</CardTitle>
                <CardDescription>Agencies and individual agents currently paying.</CardDescription>
              </CardHeader>
              <CardContent>
                <AdminAccounts />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
