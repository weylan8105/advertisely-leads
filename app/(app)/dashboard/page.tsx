"use client";

import { useState } from "react";
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
  Lock,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { LeadPerformanceChart } from "@/components/dashboard/LeadPerformanceChart";
import { LeadTable } from "@/components/leads/LeadTable";
import { OrderTable } from "@/components/orders/OrderTable";
import { ExportButton } from "@/components/leads/ExportButton";
import { TaskList } from "@/components/leads/TaskList";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { mockLeads, allTasks } from "@/data/leads";
import { mockOrders } from "@/data/orders";
import { currentUser } from "@/data/user";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}
let toastCounter = 0;

export default function DashboardPage() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ghlLoading, setGhlLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [replacementLoading, setReplacementLoading] = useState(false);

  const newCount = mockLeads.filter((l) => l.status === "New").length;
  const contactedCount = mockLeads.filter((l) => l.status === "Contacted").length;
  const apptCount = mockLeads.filter((l) => l.status === "Appointment Set").length;
  const closedCount = mockLeads.filter((l) => l.status === "Closed").length;

  const today = new Date();
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tasksToday = allTasks().filter((t) => !t.done && new Date(t.dueAt) <= todayEnd);

  function addToast(type: "success" | "error" | "info", message: string) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleExportCSV() {
    setCsvLoading(true);
    try {
      const res = await fetch("/api/exports/csv");
      if (!res.ok) {
        addToast("error", "CSV export failed. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "advertisely-leads.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast("success", "All leads exported to CSV.");
    } catch {
      addToast("error", "Failed to download CSV. Please try again.");
    } finally {
      setCsvLoading(false);
    }
  }

  async function handleGHLPush() {
    setGhlLoading(true);
    try {
      const res = await fetch("/api/exports/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: mockLeads.map((l) => l.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast("error", data.error ?? "GHL push failed. Check your GHL connection in Settings.");
      } else {
        addToast("success", `Pushed ${data.pushed ?? "all"} leads to GoHighLevel.`);
      }
    } catch {
      addToast("error", "Failed to push to GoHighLevel. Check your GHL connection in Settings.");
    } finally {
      setGhlLoading(false);
    }
  }

  async function handleReplacementRequest() {
    setReplacementLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    addToast(
      "success",
      "Replacement request submitted for all flagged leads. Our team will review within 72 hours.",
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
        eyebrow={`Welcome back, ${currentUser.name.split(" ")[0]}`}
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
          value={mockLeads.length}
          delta={12.4}
          hint="vs last 30 days"
          accent="teal"
          icon={<Users className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="New leads"
          value={newCount}
          delta={8.2}
          hint="last 7 days"
          accent="blue"
          icon={<UserPlus className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Contacted"
          value={contactedCount}
          delta={4.1}
          hint="last 7 days"
          accent="violet"
          icon={<PhoneCall className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Appointments"
          value={apptCount}
          delta={22.0}
          hint="last 7 days"
          accent="amber"
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Closed (placeholder)"
          value={closedCount}
          delta={-2.1}
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
              <CardTitle>Today's tasks</CardTitle>
              <CardDescription>
                {tasksToday.length} due today across your pipeline
              </CardDescription>
            </div>
            <Link href="/leads">
              <Button variant="ghost" size="sm">
                All <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="flex-1">
            <TaskList tasks={tasksToday.slice(0, 5)} emptyHint="No tasks due today. Nice." />
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
            {/* Power dial — opens tel: link for first lead */}
            <QuickActionButton
              icon={Phone}
              label="Start power-dial session"
              tone="emerald"
              onClick={() => {
                const first = mockLeads[0];
                if (first) window.open(`tel:${first.phone.replace(/\D/g, "")}`);
              }}
            />

            {/* Bulk SMS — opens SMS to first lead */}
            <QuickActionButton
              icon={MessageSquare}
              label="Send bulk SMS template"
              tone="sky"
              onClick={() => {
                const first = mockLeads[0];
                if (first) window.open(`sms:${first.phone.replace(/\D/g, "")}`);
              }}
            />

            {/* Bulk email — opens mailto */}
            <QuickActionButton
              icon={Mail}
              label="Send bulk email template"
              tone="violet"
              onClick={() => {
                const emails = mockLeads
                  .slice(0, 10)
                  .map((l) => l.email)
                  .join(",");
                window.open(`mailto:${emails}`);
              }}
            />

            {/* Export to Google Sheets — coming soon */}
            <QuickActionButton
              icon={FileSpreadsheet}
              label="Export to Google Sheets"
              hint="Coming soon"
              tone="emerald"
              comingSoon
              onClick={() =>
                addToast(
                  "info",
                  "Google Sheets sync is coming soon. Use CSV export for now.",
                )
              }
            />

            {/* Push to GHL */}
            <QuickActionButton
              icon={ghlLoading ? Loader2 : Plug}
              label="Push all leads to GoHighLevel"
              loading={ghlLoading}
              onClick={handleGHLPush}
            />

            {/* Request replacements */}
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
              ["New", newCount, "bg-brand-red/20"],
              ["Contacted", contactedCount, "bg-sky-500/20"],
              ["Appointment Set", apptCount, "bg-violet-500/20"],
              ["Closed", closedCount, "bg-emerald-500/20"],
            ].map(([label, count, color]) => {
              const pct = mockLeads.length
                ? Math.round(((count as number) / mockLeads.length) * 100)
                : 0;
              return (
                <div key={label as string}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{label}</span>
                    <span className="text-muted-foreground">
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${color as string}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Recent orders</h2>
            <p className="text-xs text-muted-foreground">Delivery progress streams in real-time.</p>
          </div>
          <Link href="/orders">
            <Button variant="ghost" size="sm">
              View all <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
        <OrderTable orders={mockOrders.slice(0, 3)} />
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
        <LeadTable leads={mockLeads.slice(0, 6)} showBulk={false} compact />
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
  const colors: Record<string, string> = {
    emerald: "text-emerald-600",
    sky: "text-sky-600",
    violet: "text-violet-600",
  };
  return (
    <button
      className="w-full flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-2.5 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onClick}
      disabled={loading}
    >
      <span className="flex items-center gap-2.5 text-sm">
        <Icon
          className={`h-4 w-4 ${tone ? colors[tone] : "text-brand-red"} ${loading ? "animate-spin" : ""}`}
        />
        {label}
      </span>
      {hint && !comingSoon && <span className="text-[10px] text-emerald-600">{hint}</span>}
      {comingSoon && <Lock className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}
