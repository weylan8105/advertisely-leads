"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Coins } from "lucide-react";
import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { formatCurrency } from "@/lib/utils";

/**
 * Advertisely Bucks Marketing Campaign (draft): the caller's Bucks balance,
 * shown in the top bar just left of the account button. Hidden for admins
 * (they can't earn or spend Bucks) and while the program flag is off.
 */
export function BucksPill() {
  const { status } = useSession();
  const [bucks, setBucks] = useState<number | null>(null);

  useEffect(() => {
    if (!REFERRAL_PROGRAM_ENABLED || status !== "authenticated") return;
    const load = () =>
      fetch("/api/referral")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setBucks(d && d.bucksEnabled ? d.bucksCents : null))
        .catch(() => {});
    load();
    // Refresh when the tab regains focus (e.g. after a referral purchase lands).
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [status]);

  if (!REFERRAL_PROGRAM_ENABLED || bucks === null) return null;

  return (
    <Link
      href="/rewards"
      title="Advertisely Bucks — earn $12 for every fresh lead bought with your code"
      className="flex h-9 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-emerald-700 hover:bg-emerald-100"
    >
      <Coins className="h-4 w-4" />
      <span className="text-sm font-semibold tabular-nums">{formatCurrency(bucks / 100)}</span>
      <span className="hidden sm:inline text-[10px] font-medium uppercase tracking-wide text-emerald-700/80">Bucks</span>
    </Link>
  );
}
