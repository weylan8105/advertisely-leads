import { notFound } from "next/navigation";
import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { RewardsView } from "@/components/rewards/RewardsView";

export const dynamic = "force-dynamic";

/** Advertisely Bucks Marketing Campaign (draft): your code + Bucks. 404 while the flag is off. */
export default function RewardsPage() {
  if (!REFERRAL_PROGRAM_ENABLED) notFound();
  return <RewardsView />;
}
