"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X, Pencil, Check, Ban, RotateCcw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AVAILABLE_STATES, stateName } from "@/data/states";
import { formatCurrency, cn } from "@/lib/utils";

interface AdminOrder {
  id: string;
  packageName: string;
  quantity: number;
  delivered: number;
  totalCents: number;
  bucksAppliedCents: number;
  status: "PENDING" | "PROCESSING" | "DELIVERING" | "DELIVERED" | "REFUNDED";
  open: boolean;
  filterStates: string[];
  createdAt: string;
  boughtBy: string | null;
  routedTo: string | null;
}

const STATUS_LABEL: Record<AdminOrder["status"], { text: string; variant: "success" | "info" | "warning" | "muted" | "destructive" }> = {
  PENDING: { text: "Pending", variant: "warning" },
  PROCESSING: { text: "Open", variant: "info" },
  DELIVERING: { text: "Delivering", variant: "info" },
  DELIVERED: { text: "Complete", variant: "success" },
  REFUNDED: { text: "Refunded", variant: "destructive" },
};

/** Admin: view and manage one client's lead orders (states, quantity, close/reopen, fill). */
export function ClientOrdersModal({
  account,
  onClose,
}: {
  account: { userId: string; name: string | null; email: string };
  onClose: (changed: boolean) => void;
}) {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [changed, setChanged] = useState(false);
  const [editStates, setEditStates] = useState<{ id: string; states: string[] } | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetch(`/api/admin/orders?userId=${encodeURIComponent(account.userId)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || "Couldn't load orders");
        setOrders(d.orders ?? []);
      })
      .catch((e) => setError(e.message));
  }, [account.userId]);
  useEffect(() => { load(); }, [load]);

  async function act(order: AdminOrder, action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(`${order.id}-${action}`);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, action, ...extra }),
      });
      const d = await res.json().catch(() => ({}));
      setMsg({ id: order.id, ok: res.ok, text: d.message || d.error || (res.ok ? "Done." : "Something went wrong.") });
      if (res.ok) { setChanged(true); load(); }
    } finally {
      setBusy(null);
    }
  }

  async function saveStates(order: AdminOrder, states: string[]) {
    setBusy(`${order.id}-states`);
    setMsg(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/states`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states }),
      });
      const d = await res.json().catch(() => ({}));
      setMsg({ id: order.id, ok: res.ok, text: res.ok ? "States updated — future leads use the new set." : d.error || "Couldn't update states." });
      if (res.ok) { setEditStates(null); setChanged(true); load(); }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => onClose(changed)} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight truncate">{account.name ?? account.email} — lead orders</h2>
            <p className="text-xs text-muted-foreground">Change states, quantity, or close/reopen an order. Billing is never changed here.</p>
          </div>
          <button onClick={() => onClose(changed)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto flex-1 space-y-3">
          {error ? (
            <div className="text-sm text-rose-600 py-8 text-center">{error}</div>
          ) : orders === null ? (
            <div className="flex items-center gap-2 justify-center py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading orders…
            </div>
          ) : orders.length === 0 ? (
            <div className="text-sm text-muted-foreground py-10 text-center">No lead orders for this account.</div>
          ) : (
            orders.map((o) => {
              const pct = o.quantity ? Math.round((o.delivered / o.quantity) * 100) : 0;
              const st = STATUS_LABEL[o.status];
              const editing = editStates?.id === o.id;
              const isBusy = (a: string) => busy === `${o.id}-${a}`;
              const qty = qtyDraft[o.id] ?? String(o.quantity);
              return (
                <div key={o.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{o.packageName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(o.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        {" · "}{formatCurrency(Math.max(0, o.totalCents - o.bucksAppliedCents) / 100)}
                        {o.bucksAppliedCents > 0 && <> cash + {formatCurrency(o.bucksAppliedCents / 100)} Bucks</>}
                        {o.boughtBy && <> · bought by {o.boughtBy}</>}
                        {o.routedTo && <> · delivers to {o.routedTo}</>}
                        <span className="font-mono"> · #{o.id.slice(-6)}</span>
                      </div>
                    </div>
                    <Badge variant={st.variant as any}>{st.text}</Badge>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={pct} className="h-2 flex-1" />
                    <span className="text-xs tabular-nums text-muted-foreground w-24 text-right">{o.delivered} / {o.quantity} delivered</span>
                  </div>

                  {/* States */}
                  <div className="mt-3">
                    {editing ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {AVAILABLE_STATES.map((code) => {
                            const on = editStates!.states.includes(code);
                            return (
                              <button
                                key={code}
                                title={stateName(code)}
                                type="button"
                                onClick={() =>
                                  setEditStates((e) => e && { ...e, states: on ? e.states.filter((s) => s !== code) : [...e.states, code] })
                                }
                                className={cn(
                                  "rounded-md border px-2 py-1 text-[11px] font-medium",
                                  on ? "border-brand-red bg-brand-red/10 text-brand-red" : "border-slate-200 text-muted-foreground hover:border-slate-300",
                                )}
                              >
                                {code}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => saveStates(o, editStates!.states)} disabled={isBusy("states") || editStates!.states.length === 0}>
                            {isBusy("states") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save states
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditStates(null)}>Cancel</Button>
                          <span className="text-[11px] text-muted-foreground">{editStates!.states.length} selected</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-muted-foreground">States:</span>
                        {o.filterStates.length ? (
                          o.filterStates.map((s) => (
                            <span key={s} title={stateName(s)} className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{s}</span>
                          ))
                        ) : (
                          <span className="text-rose-600">none set — this order won&apos;t receive leads</span>
                        )}
                        {o.open && (
                          <button type="button" onClick={() => setEditStates({ id: o.id, states: [...o.filterStates] })}
                            className="ml-1 inline-flex items-center gap-1 font-medium text-brand-red hover:underline">
                            <Pencil className="h-3 w-3" /> Edit states
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {o.status !== "REFUNDED" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <label className="text-[11px] text-muted-foreground">Quantity</label>
                      <input
                        type="number"
                        min={Math.max(1, o.delivered)}
                        value={qty}
                        onChange={(e) => setQtyDraft((d) => ({ ...d, [o.id]: e.target.value }))}
                        className="h-8 w-20 rounded-md border border-slate-200 px-2 text-sm focus:border-brand-red/50 focus:outline-none"
                      />
                      <Button size="sm" variant="outline" disabled={isBusy("quantity") || Number(qty) === o.quantity || !qty}
                        onClick={() => act(o, "quantity", { quantity: Number(qty) })}>
                        {isBusy("quantity") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
                      </Button>
                      <span className="flex-1" />
                      {o.open ? (
                        <>
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(o, "fill")}>
                            {isBusy("fill") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Fill now
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" disabled={!!busy}
                            onClick={() => act(o, "close", {}, `Close this order at ${o.delivered} of ${o.quantity}? No more leads will be delivered to it.`)}>
                            {isBusy("close") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Close order
                          </Button>
                        </>
                      ) : (
                        o.delivered < o.quantity && (
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(o, "reopen")}>
                            {isBusy("reopen") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reopen
                          </Button>
                        )
                      )}
                    </div>
                  )}
                  {msg?.id === o.id && (
                    <p className={cn("mt-2 text-[11px]", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
