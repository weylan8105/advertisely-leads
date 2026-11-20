"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { AdminLiveStats } from "@/components/admin/AdminLiveStats";

/** Internal: what every client produced over the rolling 30 days (admins only — see layout.tsx). */
export default function ClientPerformancePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Internal · Advertisely Admin"
        title="Client Performance"
        description="Real production across every agent over the rolling last 30 days: the same totals shown live on the public homepage, with the agents behind them."
        className="mb-5"
      />
      <AdminLiveStats />
    </div>
  );
}
