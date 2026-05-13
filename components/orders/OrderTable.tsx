import Link from "next/link";
import { FileText, Eye } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/leads/StatusBadge";
import type { Order } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";

export function OrderTable({ orders }: { orders: Order[] }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Package</TableHead>
            <TableHead className="hidden md:table-cell">Quantity</TableHead>
            <TableHead className="hidden md:table-cell">Total</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const pct = Math.round((order.delivered / order.total_leads) * 100);
            return (
              <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">{order.id}</TableCell>
                <TableCell>{order.items[0].packageName}</TableCell>
                <TableCell className="hidden md:table-cell">{order.items[0].quantity}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {formatCurrency(order.total)}
                </TableCell>
                <TableCell className="min-w-[140px]">
                  <div className="flex items-center gap-2">
                    <Progress value={pct} className="h-1.5 max-w-[100px]" />
                    <span className="text-xs text-muted-foreground">
                      {order.delivered}/{order.total_leads}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {formatDate(order.date)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Link href="/leads">
                      <Button size="sm" variant="ghost">
                        <Eye className="h-3.5 w-3.5" /> Leads
                      </Button>
                    </Link>
                    <Button size="sm" variant="ghost">
                      <FileText className="h-3.5 w-3.5" /> Invoice
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
