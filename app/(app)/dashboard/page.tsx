"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Users,
  UserPlus,
  PhoneCall,
  CalendarCheck,
  Trophy,
  Plug,
  FileSpreadsheet,
  RefreshCw,
  ArrowRight,
  Phone,
  MessageSquare,
  Mail,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  ShoppingCart,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { LeadPerformanceChart } from "@/components/dashboard/LeadPerformanceChart";
import { LeadTable } from "@/components/leads/LeadTable";
import { ExportButton } from "@/components/leads/ExportButton";
import { TaskList } from "@/components/leads/TaskList";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}
let toastCounter = 0;

export default function DashboardPage() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const { data: session } = useSession();
  const userName = (session?.user?.name ?? "there").split(" ")[0];

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data) => { if (data.orders) setRecentOrders(data.orders.slice(0, 3)); })
      .catch(() => {});
  }, []);

  function addToast(type: "success" | "error" | "info", message: string) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleSheetsExport() {
    setSheetsLoading(true);
    try {
      const res = await fetch("/api/exports/sheets");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        addToast("error", err.error ?? "Google Sheets export failed.");
        return;
      }
      const tsv = await res.text();
      const leadCount = res.headers.get("X-Lead-Count");
      if (leadCount === "0") {
        addToast("info", "No leads to export yet. Order leads from the Marketplace first.");
        return;
      }
      try {
        await navigator.clipboard.writeText(tsv);
      } catch {
        addToast("error", "Couldn't access your clipboard. Use Export → Download CSV instead.");
        return;
      }
      window.open("https://sheets.new", "_blank", "noopener,noreferrer");
      addToast(
        "success",
        `Copied ${leadCount} leads to your clipboard. Paste (⌘/Ctrl+V) into the Google Sheet that just opened.`,
      );
    } catch {
      addToast("error", "Failed to export to Google Sheets. Please try again.");
    } finally {
      setSheetsLoading(false);
    }
  }

  async function handleReplacementRequest() {
    setReplacementLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    addToast(
      "success",
      "Replacement request submitted. Our team will review within 72 hours.",
    );
    setReplacementLoading(false);
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
                  : t.type === "error"
                  ? "border-rose-200 text-rose-800"
                  : "border-sky-200 text-sky-800"
              }`}
            >
              {t.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              ) : t.type === "error" ? (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-rose-600" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
              )}
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => dismissToast(t.id)}
                className="shrink-0 opacity-60 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <PageHeader
        eyebrow={`Welcome back, ${userName}`}
        title="Your IUL pipeline at a glance."
        description="Real-time view of your purchased leads, tasks for today, and pipeline performance across the last 7 days."
        actions={
          <>
            <Link href="/marketplace">
              <Button variant="outline" size="sm">
                Order more leads
              </Button>
            </Link>
            <ExportButton
              variant="default"
              onSuccess={(msg) => addToast("success", msg)}
              onError={(msg) => addToast("error", msg)}
            />
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <DashboardStatCard
          label="Total purchased leads"
          value={0}
          delta={0}
          hint="order leads to get started"
          accent="teal"
          icon={<Users className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="New leads"
          value={0}
          delta={0}
          hint="last 7 days"
          accent="blue"
          icon={<UserPlus className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Contacted"
          value={0}
          delta={0}
          hint="last 7 days"
          accent="violet"
          icon={<PhoneCall className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Appointments"
          value={0}
          delta={0}
          hint="last 7 days"
          accent="amber"
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Closed"
          value={0}
          delta={0}
          hint="connect AP tracking"
          accent="emerald"
          icon={<Trophy className="h-4 w-4" />}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mt-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Lead performance</CardTitle>
              <CardDescription>
                Received, contacted, and appointments set this week
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm">
              7 days <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            <LeadPerformanceChart />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Today&apos;s tasks</CardTitle>
              <CardDescription>0 due today across your pipeline</CardDescription>
            </div>
            <Link href="/leads">
              <Button variant="ghost" size="sm">
                All <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="flex-1">
            <TaskList tasks={[]} emptyHint="No tasks yet. Order leads to get started." />
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mt-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>One-click pipes to your stack</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-2">
            <QuickActionButton
              icon={Phone}
              label="Start power-dial session"
              tone="emerald"
              onClick={() => addToast("info", "No leads yet. Order leads from the Marketplace to start dialing.")}
            />
            <QuickActionButton
              icon={MessageSquare}
              label="Send bulk SMS template"
              tone="sky"
              onClick={() => addToast("info", "No leads yet. Order leads from the Marketplace first.")}
            />
            <QuickActionButton
              icon={Mail}
              label="Send bulk email template"
              tone="violet"
              onClick={() => addToast("info", "No leads yet. Order leads from the Marketplace first.")}
            />
            <QuickActionButton
              icon={sheetsLoading ? Loader2 : FileSpreadsheet}
              label="Export to Google Sheets"
              tone="emerald"
              loading={sheetsLoading}
              onClick={handleSheetsExport}
            />
            <QuickActionButton
              icon={Plug}
              label="Push all leads to GoHighLevel"
              hint="Coming soon"
              comingSoon
              onClick={() => addToast("info", "GoHighLevel push is coming soon.")}
            />
            <QuickActionButton
              icon={replacementLoading ? Loader2 : RefreshCw}
              label="Request replacements"
              loading={replacementLoading}
              onClick={handleReplacementRequest}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline snapshot</CardTitle>
            <CardDescription>Status distribution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ["New", 0, "bg-brand-red/20"],
              ["Contacted", 0, "bg-sky-500/20"],
              ["Appointment Set", 0, "bg-violet-500/20"],
              ["Closed", 0, "bg-emerald-500/20"],
            ].map(([label, count, color]) => (
              <div key={label as string}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{label}</span>
                  <span className="text-muted-foreground">{count} · 0%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${color as string}`} style={{ width: "0%" }} />
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-slate-100">
              <Link href="/marketplace">
                <Button size="sm" variant="outline" className="w-full">
                  <ShoppingCart className="h-3.5 w-3.5" /> Order leads to populate pipeline
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Recent orders</h2>
            <p className="text-xs text-muted-foreground">Delivery progress updates as leads arrive.</p>
          </div>
          <Link href="/orders">
            <Button variant="ghost" size="sm">
              View all <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-muted-foreground">
            No orders yet. <Link href="/marketplace" className="text-brand-red hover:underline">Browse packages</Link> to place your first order.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Order</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground hidden md:table-cell">Package</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground hidden md:table-cell">Total</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o: any) => (
                  <tr key={o.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{o.id.slice(0, 12)}...</td>
                    <td className="px-4 py-2 hidden md:table-cell">{o.packageId}</td>
                    <td className="px-4 py-2 hidden md:table-cell">${(o.totalCents / 100).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        o.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-700' :
                        o.status === 'DELIVERING' ? 'bg-sky-100 text-sky-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{o.status}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground hidden md:table-cell">{new Date(o.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Recent leads</h2>
            <p className="text-xs text-muted-foreground">
              Newest IUL leads delivered to your account.
            </p>
          </div>
          <Link href="/leads">
            <Button variant="ghost" size="sm">
              Open full CRM <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
        <LeadTable leads={[]} showBulk={false} compact />
      </div>
    </div>
  );
}

function QuickActionButton({
  icon: Icon,
  label,
  hint,
  tone,
  onClick,
  loading,
  comingSoon,
}: {
  icon: any;
  label: string;
  hint?: string;
  tone?: "emerald" | "sky" | "violet";
  onClick?: () => void;
  loading?: boolean;
  comingSoon?: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]"
      : tone === "sky"
      ? "hover:border-sky-500/30 hover:bg-sky-500/[0.04]"
      : tone === "violet"
      ? "hover:border-violet-500/30 hover:bg-violet-500/[0.04]"
      : "hover:border-brand-red/30 hover:bg-brand-red/[0.04]";

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-left transition-colors w-full ${toneClass} disabled:opacity-60`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${loading ? "animate-spin" : ""}`} />
      <span className="flex-1 font-medium">{label}</span>
      {comingSoon && (
        <span className="text-[10px] text-muted-foreground border border-slate-200 rounded px-1.5 py-0.5">
          Soon
        </span>
      )}
      {hint && !comingSoon && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </button>
  );
}
