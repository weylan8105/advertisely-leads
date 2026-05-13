import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderTable } from "@/components/orders/OrderTable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mockOrders } from "@/data/orders";
import { formatCurrency } from "@/lib/utils";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Package, Truck, DollarSign, CheckCircle2 } from "lucide-react";

export default function OrdersPage() {
  const total = mockOrders.reduce((s, o) => s + o.total, 0);
  const delivering = mockOrders.filter((o) => o.status === "Delivering").length;
  const delivered = mockOrders.filter((o) => o.status === "Delivered").length;
  const leads = mockOrders.reduce((s, o) => s + o.total_leads, 0);

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
          value={formatCurrency(total)}
          hint={`${mockOrders.length} orders`}
          accent="teal"
          icon={<DollarSign className="h-4 w-4" />}
        />
        <DashboardStatCard
          label="Leads purchased"
          value={leads}
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
        <OrderTable orders={mockOrders} />
      </Card>
    </div>
  );
}
