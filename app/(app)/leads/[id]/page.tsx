import { redirect } from "next/navigation";

// Old per-lead page (it only knew demo data, so every real lead 404'd). Lead details
// now live in the contact card: send old links/bookmarks to the CRM with it open.
export default function LeadDetailRedirect({ params }: { params: { id: string } }) {
  redirect(`/leads?open=${encodeURIComponent(params.id)}`);
}
