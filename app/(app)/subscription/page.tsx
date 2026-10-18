import { redirect } from "next/navigation";

// "Subscribe & Save" now lives inside the marketplace as a tab.
export default function SubscriptionRedirect() {
  redirect("/marketplace?tab=subscribe");
}
