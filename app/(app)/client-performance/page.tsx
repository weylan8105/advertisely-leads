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
        description="Real production across every agent for any range, live. The 30-day view is the same total shown on the public homepage."
        className="mb-5"
      />
      <AdminLiveStats />
    </div>
  );
}
