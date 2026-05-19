import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { Lock } from "lucide-react";
import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";
import type { LeadPackageId } from "@/types";
import { leadPackages } from "@/data/packages";

interface CheckoutPageProps {
  searchParams?: { pkg?: string };
}

export default function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const requested = searchParams?.pkg;
  const initial = leadPackages.find((p) => p.id === requested)?.id as LeadPackageId | undefined;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="container h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-4">
            <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              Secure checkout
            </span>
            <Link href="/marketplace" className="text-xs text-muted-foreground hover:text-foreground">
              ← Back to marketplace
            </Link>
          </div>
        </div>
      </header>
      <main className="container py-10">
        <CheckoutFlow initialPackageId={initial} />
      </main>
    </div>
  );
}
