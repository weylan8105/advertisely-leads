"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlusCircle, Loader2, Inbox } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Package, Truck, DollarSign, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DbOrder {
  id: string;
  packageId: string;
  quantity: number;
  pricePerLeadCents: number;
  totalCents: number;
  status: string;
  fulfilledCount: number;
  filterStates: string[];
  createdAt: string;
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
    "term-leads": "Term Life Leads",
  };
  return map[packageId] ?? packageId;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const pct = order.quantity > 0
                    ? Math.round((order.fulfilledCount / order.quantity) * 100)
                    : 0;
                  return (
                    <TableRow key={order.id}>
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
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(order.status) as any}>
                          {statusLabel(order.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {formatDate(order.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
