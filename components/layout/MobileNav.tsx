"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  ShoppingBag,
  Package,
  TrendingUp,
  Settings,
  Shield,
  LifeBuoy,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean };

// Quick-access tabs in the bottom bar (4 + More).
const TABS: Item[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/leads", label: "Pipeline", icon: Users },
  { href: "/marketplace", label: "Market", icon: ShoppingBag },
  { href: "/orders", label: "Orders", icon: Package },
];

// Everything, shown in the slide-up "More" sheet.
const ALL: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Lead CRM / Pipeline", icon: Users },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/orders", label: "Orders", icon: Package },
  { href: "/pnl", label: "Profit & Loss", icon: TrendingUp },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { href: "/settings", label: "Settings & Integrations", icon: Settings },
  { href: "/admin", label: "Admin Console", icon: Shield, adminOnly: true },
];

export function MobileNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href));
  const items = ALL.filter((i) => !i.adminOnly || isAdmin);

  return (
    <>
      {/* Bottom tab bar — mobile/tablet only */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  active ? "text-brand-red" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {t.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              moreOpen ? "text-brand-red" : "text-muted-foreground",
            )}
          >
            <Menu className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      {/* Slide-up "More" sheet with the full menu */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-xl max-h-[85vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+12px)]">
            <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <span className="text-sm font-semibold">Menu</span>
              <button type="button" onClick={() => setMoreOpen(false)} className="p-1 text-muted-foreground" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-2">
              {items.map((i) => {
                const Icon = i.icon;
                const active = isActive(i.href);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors",
                      active ? "bg-slate-100 text-foreground font-medium" : "text-foreground hover:bg-slate-50",
                    )}
                  >
                    <Icon className={cn("h-5 w-5", active ? "text-brand-red" : "text-muted-foreground")} />
                    {i.label}
                  </Link>
                );
              })}
              <a href="#" className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground hover:bg-slate-50">
                <LifeBuoy className="h-5 w-5" /> Support center
              </a>
              <div className="my-1 border-t border-slate-200" />
              <button
                type="button"
                onClick={() => { setMoreOpen(false); signOut({ callbackUrl: "/login" }); }}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-rose-600 hover:bg-rose-50"
              >
                <LogOut className="h-5 w-5" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
