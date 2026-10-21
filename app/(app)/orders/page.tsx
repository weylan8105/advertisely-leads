"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { PlusCircle, Loader2, Inbox, FileSpreadsheet, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { AVAILABLE_STATES, stateName } from "@/data/states";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Package, Truck, DollarSign, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RepItem {
  leadName: string;
  stage: string;
  reason: string;
  adminNote: string | null;
  at: string;
}
interface RepSummary {
  total: number;
  replaced: number;
  finding: number;
  underReview: number;
  denied: number;
  items: RepItem[];
}

interface DbOrder {
  id: string;
  packageId: string;
  quantity: number;
  pricePerLeadCents: number;
  totalCents: number;
  status: string;
  fulfilledCount: number;
  filterStates: string[];
  sheetOverrideId?: string | null;
  deliverToUserId?: string | null;
  createdAt: string;
  replacements?: RepSummary | null;
}

interface TeamMember { userId: string; name: string | null; email: string; isSelf?: boolean }

// Client-facing replacement stage → label + chip color. The admin's internal
// PENDING/APPROVED/DENIED is translated to progress the buyer can read.
function repStageMeta(stage: string): { label: string; cls: string } {
  switch (stage) {
    case "replaced":
      return { label: "Replaced", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    case "finding":
      return { label: "Finding replacement", cls: "border-sky-200 bg-sky-50 text-sky-700" };
    case "denied":
      return { label: "Not eligible", cls: "border-rose-200 bg-rose-50 text-rose-700" };
    default:
      return { label: "Under review", cls: "border-amber-200 bg-amber-50 text-amber-700" };
  }
}

function statusVariant(status: string) {
  switch (status) {
    case "DELIVERED": return "success";
    case "DELIVERING": return "info";
    case "PROCESSING": return "warning";
    case "CANCELLED": return "destructive";
    default: return "muted";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "DELIVERED": return "Delivered";
    case "DELIVERING": return "Delivering";
    case "PROCESSING": return "Processing";
    case "CANCELLED": return "Cancelled";
    default: return status;
  }
}

function packageLabel(packageId: string) {
  const map: Record<string, string> = {
    "blue-collar-iul": "Blue-Collar IUL Leads",
    "trucker-leads": "Trucker IUL Leads",
  };
  return map[packageId] ?? packageId;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sheetInput, setSheetInput] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);
  const [sheetMsg, setSheetMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
  // Team routing: owners can deliver an order to a downline agent.
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [routingId, setRoutingId] = useState<string | null>(null);
  const [routeMsg, setRouteMsg] = useState<string | null>(null);
  // Editing the states an open order pulls leads from.
  const [editingStatesId, setEditingStatesId] = useState<string | null>(null);
  // Which order's replacement-request detail row is expanded.
  const [repOpenId, setRepOpenId] = useState<string | null>(null);
  const [statesDraft, setStatesDraft] = useState<string[]>([]);
  const [savingStates, setSavingStates] = useState(false);
  const [statesMsg, setStatesMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [licensedStates, setLicensedStates] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/account/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.licensedStates)) setLicensedStates(d.licensedStates);
      })
      .catch(() => {});
  }, []);

  function openStatesEditor(order: DbOrder) {
    setEditingStatesId(order.id);
    setStatesDraft(order.filterStates ?? []);
    setStatesMsg(null);
    setEditingId(null); // close the sheet editor if open
  }

  function toggleDraftState(code: string) {
    setStatesDraft((prev) => (prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]));
  }

  async function saveStates(orderId: string) {
    setSavingStates(true);
    setStatesMsg(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/states`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states: statesDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, filterStates: data.states } : o)));
        setStatesMsg({ type: "success", text: "States updated — future leads will use the new set." });
      } else {
        setStatesMsg({ type: "error", text: data.error || "Couldn't update the states." });
      }
    } catch {
      setStatesMsg({ type: "error", text: "Something went wrong updating the states." });
    } finally {
      setSavingStates(false);
    }
  }

  useEffect(() => {
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCanManage(!!d.canManage);
        setMembers((d.members ?? []).map((m: any) => ({ userId: m.userId, name: m.name, email: m.email, isSelf: m.isSelf })));
      })
      .catch(() => {});
  }, []);

  async function routeOrder(order: DbOrder, value: string) {
    const userId = value === "me" ? null : value;
    setRoutingId(order.id);
    setRouteMsg(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/route-to`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRouteMsg(data.error || "Couldn't route the order.");
        return;
      }
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, deliverToUserId: userId } : o)));
      const nm = value === "me" ? "you" : (members.find((m) => m.userId === value)?.name ?? "the agent");
      setRouteMsg(
        userId
          ? `Order now delivers to ${nm}${data.movedExisting ? ` — ${data.movedExisting} existing lead${data.movedExisting === 1 ? "" : "s"} moved${data.emailed ? " and emailed" : ""}` : ""}.`
          : "Routing cleared — this order now delivers to you.",
      );
    } catch {
      setRouteMsg("Something went wrong routing the order.");
    } finally {
      setRoutingId(null);
    }
  }

  const downline = members.filter((m) => !m.isSelf);

  function openSheetEditor(order: DbOrder) {
    setEditingId(order.id);
    setSheetMsg(null);
    setSheetInput(
      order.sheetOverrideId
        ? `https://docs.google.com/spreadsheets/d/${order.sheetOverrideId}`
        : "",
    );
  }

  async function saveSheet(orderId: string, clear = false) {
    setSavingSheet(true);
    setSheetMsg(null);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, sheetUrl: clear ? "" : sheetInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSheetMsg({ type: "error", text: data.error ?? "Couldn't update the sheet." });
        return;
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, sheetOverrideId: data.sheetOverrideId } : o)),
      );
      setSheetMsg({
        type: "success",
        text: clear ? "Now using your default sheet." : "Custom sheet connected for this order.",
      });
      if (clear) setEditingId(null);
    } catch {
      setSheetMsg({ type: "error", text: "Something went wrong. Please try again." });
    } finally {
      setSavingSheet(false);
    }
  }

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data) => {
        if (data.orders) {
          setOrders(data.orders);
        } else {
          setError(data.error ?? "Failed to load orders");
        }
      })
      .catch(() => setError("Failed to load orders"))
      .finally(() => setLoading(false));
  }, []);

  const totalSpent = orders.reduce((s, o) => s + o.totalCents, 0) / 100;
  const totalLeads = orders.reduce((s, o) => s + o.quantity, 0);
  const delivering = orders.filter((o) => o.status === "DELIVERING").length;
  const delivered = orders.filter((o) => o.status === "DELIVERED").length;

  return (
    <div>
      <PageHeader
        eyebrow="Orders"
        title="Order history"
        description="Every order you've placed with Advertisely, with delivery progress and invoice receipts."
        actions={
          <Link href="/marketplace">
            <Button size="sm">
              <PlusCircle className="h-4 w-4" />
              Place new order
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <DashboardStatCard
          label="Total spent"
          value={formatCurrency(totalSpent)}
          hint={`${orders.length} order${orders.length !== 1 ? "s" : ""}`}
          accent="teal"
          icon={<DollarSign className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Leads purchased"
          value={totalLeads}
          hint="lifetime"
          accent="blue"
          icon={<Package className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Delivering now"
          value={delivering}
          hint="in progress"
          accent="amber"
          icon={<Truck className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Completed"
          value={delivered}
          hint="fully delivered"
          accent="emerald"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold mb-4">All orders</h2>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-sm">Loading orders...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <p className="text-sm font-medium text-red-500">{error}</p>
            <p className="text-xs">Please try refreshing the page.</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">No orders yet</p>
            <p className="text-xs">Your orders will appear here after your first purchase.</p>
            <Link href="/marketplace" className="mt-2">
              <Button size="sm" variant="outline">Browse packages</Button>
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead className="hidden md:table-cell">Qty</TableHead>
                  <TableHead className="hidden md:table-cell">Total</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sheet</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const pct = order.quantity > 0
                    ? Math.round((order.fulfilledCount / order.quantity) * 100)
                    : 0;
                  return (
                    <Fragment key={order.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">{order.id.slice(0, 12)}...</TableCell>
                      <TableCell className="text-sm">{packageLabel(order.packageId)}</TableCell>
                      <TableCell className="hidden md:table-cell">{order.quantity}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {formatCurrency(order.totalCents / 100)}
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-1.5 max-w-[100px]" />
                          <span className="text-xs text-muted-foreground">
                            {order.fulfilledCount}/{order.quantity}
                          </span>
                        </div>
                        {canManage && downline.length > 0 && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                            <Select
                              value={order.deliverToUserId ?? "me"}
                              onValueChange={(v) => routeOrder(order, v)}
                            >
                              <SelectTrigger className="h-6 text-[11px] w-[150px] px-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="me">Deliver to me</SelectItem>
                                {downline.map((m) => (
                                  <SelectItem key={m.userId} value={m.userId}>
                                    To {m.name ?? m.email}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {routingId === order.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                          </div>
                        )}
                        {["PENDING", "PROCESSING", "DELIVERING"].includes(order.status) && (
                          <div className="mt-1.5 text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">{(order.filterStates ?? []).length}</span>{" "}
                            state{(order.filterStates ?? []).length === 1 ? "" : "s"}
                            {(order.filterStates ?? []).length > 0 && (
                              <>: {(order.filterStates ?? []).slice(0, 6).join(", ")}
                                {(order.filterStates ?? []).length > 6 ? ` +${order.filterStates.length - 6}` : ""}</>
                            )}{" · "}
                            <button
                              type="button"
                              onClick={() => openStatesEditor(order)}
                              className="font-medium text-brand-red hover:underline"
                            >
                              Edit states
                            </button>
                          </div>
                        )}
                        {order.replacements && order.replacements.total > 0 && (
                          <div className="mt-1.5">
                            <button
                              type="button"
                              onClick={() => setRepOpenId(repOpenId === order.id ? null : order.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-red hover:underline"
                            >
                              <RefreshCw className="h-3 w-3" />
                              {order.replacements.total} replacement{order.replacements.total === 1 ? "" : "s"}
                              {order.replacements.replaced > 0 ? ` · ${order.replacements.replaced} done` : ""}
                              {order.replacements.finding + order.replacements.underReview > 0
                                ? ` · ${order.replacements.finding + order.replacements.underReview} in progress`
                                : ""}
                            </button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(order.status) as any}>
                          {statusLabel(order.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => openSheetEditor(order)}
                          className="inline-flex items-center gap-1.5 text-xs hover:underline"
                        >
                          <FileSpreadsheet className={order.sheetOverrideId ? "h-3.5 w-3.5 text-emerald-600" : "h-3.5 w-3.5 text-muted-foreground"} />
                          {order.sheetOverrideId ? (
                            <span className="text-emerald-700 font-medium">Custom</span>
                          ) : (
                            <span className="text-muted-foreground">Default</span>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {formatDate(order.createdAt)}
                      </TableCell>
                    </TableRow>
                    {editingId === order.id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-slate-50">
                          <div className="py-1 space-y-2 max-w-2xl">
                            <div className="text-xs text-muted-foreground">
                              By default this order's leads sync to your connected sheet
                              (Settings → Integrations). To send <strong>this order</strong> to a
                              different sheet, share it with the Advertisely service account as an
                              Editor, then paste its link here.
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <Input
                                value={sheetInput}
                                onChange={(e) => setSheetInput(e.target.value)}
                                placeholder="https://docs.google.com/spreadsheets/d/…"
                                className="flex-1"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => saveSheet(order.id)}
                                  disabled={savingSheet || !sheetInput.trim()}
                                >
                                  {savingSheet ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                  Save
                                </Button>
                                {order.sheetOverrideId && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => saveSheet(order.id, true)}
                                    disabled={savingSheet}
                                  >
                                    Use default
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingId(null)}
                                  disabled={savingSheet}
                                >
                                  Close
                                </Button>
                              </div>
                            </div>
                            {sheetMsg && (
                              <p className={sheetMsg.type === "error" ? "text-xs text-rose-600" : "text-xs text-emerald-600"}>
                                {sheetMsg.text}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {repOpenId === order.id && order.replacements && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-slate-50">
                          <div className="max-w-2xl space-y-2 py-2">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-xs font-semibold">
                                Replacement requests ({order.replacements.total})
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {order.replacements.replaced} replaced ·{" "}
                                {order.replacements.finding + order.replacements.underReview} in progress
                                {order.replacements.denied > 0 ? ` · ${order.replacements.denied} not eligible` : ""}
                              </span>
                            </div>
                            <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                              {order.replacements.items.map((it, i) => {
                                const meta = repStageMeta(it.stage);
                                return (
                                  <div key={i} className="flex items-start gap-3 px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-xs font-medium">{it.leadName || "Lead"}</div>
                                      {it.reason && (
                                        <div className="truncate text-[11px] text-muted-foreground">{it.reason}</div>
                                      )}
                                      {it.adminNote && (
                                        <div className="text-[11px] italic text-muted-foreground">Note: {it.adminNote}</div>
                                      )}
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", meta.cls)}>
                                        {meta.label}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">{formatDate(it.at)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Replacements for valid leads are delivered fresh as new matching inventory comes in.
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {editingStatesId === order.id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-slate-50">
                          <div className="max-w-2xl space-y-2 py-2">
                            <div className="text-xs text-muted-foreground">
                              Choose the states this order pulls leads from. <strong>Future</strong> leads use the
                              new set — already-delivered leads stay. You can only select states you&apos;re
                              licensed in{licensedStates.length === 0 ? " (set your licensed states in Settings → Profile)" : ""}.
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {(licensedStates.length ? licensedStates : AVAILABLE_STATES).map((code) => {
                                const on = statesDraft.includes(code);
                                return (
                                  <button
                                    key={code}
                                    title={stateName(code)}
                                    type="button"
                                    onClick={() => toggleDraftState(code)}
                                    className={cn(
                                      "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                                      on
                                        ? "border-brand-red bg-brand-red/10 text-brand-red"
                                        : "border-slate-200 bg-white text-muted-foreground hover:border-slate-300",
                                    )}
                                  >
                                    {code}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button size="sm" onClick={() => saveStates(order.id)} disabled={savingStates || statesDraft.length === 0}>
                                {savingStates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save states
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingStatesId(null)}>
                                Cancel
                              </Button>
                              <span className="text-[11px] text-muted-foreground">{statesDraft.length} selected</span>
                              {statesMsg && (
                                <span className={cn("text-[11px]", statesMsg.type === "error" ? "text-rose-600" : "text-emerald-600")}>
                                  {statesMsg.text}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {routeMsg && (
        <div
          className="fixed bottom-4 right-4 z-50 max-w-sm cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg"
          onClick={() => setRouteMsg(null)}
        >
          {routeMsg}
        </div>
      )}
    </div>
  );
}
