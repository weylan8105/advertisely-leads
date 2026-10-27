"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { BusinessPnlPanel } from "@/components/admin/BusinessPnlPanel";

/** Internal: Advertisely's own business P&L (admins only — see layout.tsx). */
export default function BusinessPnlPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal · Advertisely Admin"
        title="Business P&L"
        description="Advertisely's net: client lead sales plus house-lead reimbursements, minus ad spend and Stripe fees."
      />
      <BusinessPnlPanel />
    </div>
  );
}
