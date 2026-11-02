"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { AdBulkUploader } from "@/components/admin/AdBulkUploader";

/** Internal: bulk-create paused Facebook campaigns in client ad accounts (admins only — see layout.tsx). */
export default function AdUploaderPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal · Advertisely Admin"
        title="Advertisely Ad Bulk Uploader"
        description="Build campaigns, ad sets and ads for a client's Facebook ad account from one sheet. Everything is created paused for review in Ads Manager."
      />
      <AdBulkUploader />
    </div>
  );
}
