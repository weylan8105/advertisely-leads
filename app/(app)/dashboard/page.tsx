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
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { LeadPerformanceChart } from "@/components/dashboard/LeadPerformanceChart";
import { LeadTable } from "@/components/leads/LeadTable";
import { OrderTable } from "@/components/orders/OrderTable";
import { ExportButton } from "@/components/leads/ExportButton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { mockLeads } from "@/data/leads";
import { mockOrders } from "@/data/orders";
import { currentUser } from "@/data/user";

export default function DashboardPage() {
  const newCount = mockLeads.filter((l) => l.status === "New").length;
  const contactedCount = mockLeads.filter((l) => l.status === "Contacted").length;
  const apptCount = mockLeads.filter((l) => l.status === "Appointment Set").length;
  const closedCount = mockLeads.filter((l) => l.status === "Closed").length;

  return (
    <div>
      <PageHeader
        eyebrow={`Welcome back, ${currentUser.name.split(" ")[0]}`}
        title="Your IUL pipeline at a glance."
        description="Real-time view of your purchased leads, ordered packages, and pipeline performance across the last 7 days."
        actions={
          <>
            <Link href="/marketplace">
              <Button variant="outline" size="sm">
                Order more leads
              </Button>
            </Link>
            <ExportButton variant="default" />
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
              <CardDescription>Received, contacted, and appointments set this week</CardDescription>
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
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>One-click pipes to your stack</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-2">
            <QuickAction icon={FileSpreadsheet} label="Export to Google Sheets" hint="Connected" />
            <QuickAction icon={Plug} label="Push selected to GoHighLevel" />
            <QuickAction icon={FileSpreadsheet} label="Download CSV (all leads)" />
            <QuickAction icon={RefreshCw} label="Request replacements" />
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Recent orders</h2>
            <p className="text-xs text-muted-foreground">
              Delivery progress streams in real-time.
            </p>
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

function QuickAction({
  icon: Icon,
  label,
  hint,
}: {
  icon: any;
  label: string;
  hint?: string;
}) {
  return (
    <button className="w-full flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] px-3 py-2.5 transition-colors">
      <span className="flex items-center gap-2.5 text-sm">
        <Icon className="h-4 w-4 text-brand-teal" />
        {label}
      </span>
      {hint && <span className="text-[10px] text-emerald-300">{hint}</span>}
    </button>
  );
}
