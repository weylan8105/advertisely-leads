"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Package,
  Settings,
  Shield,
  Sparkles,
  LifeBuoy,
} from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
  adminOnly?: boolean;
};

const sections: { title: string; items: NavItem[]; adminOnly?: boolean }[] = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/leads", label: "Leads CRM", icon: Users },
      { href: "/orders", label: "Orders", icon: Package },
      { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/settings", label: "Settings & Integrations", icon: Settings },
    ],
  },
  {
    title: "Internal",
    adminOnly: true,
    items: [
      { href: "/admin", label: "Admin Console", icon: Shield, badge: "Admin" },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  // Hide admin-only sections from everyone who isn't an admin.
  const visibleSections = sections.filter((s) => !s.adminOnly || isAdmin);
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white min-h-screen sticky top-0">
      <div className="px-5 h-16 flex items-center border-b border-slate-200">
        <Logo href="/dashboard" />
      </div>
      <div className="flex-1 overflow-y-auto py-5 px-3 space-y-6 scrollbar-thin">
        {visibleSections.map((section) => (
          <div key={section.title}>
            <div className="px-2 mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80 font-medium">
              {section.title}
            </div>
            <nav className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-slate-100 text-foreground"
                        : "text-muted-foreground hover:bg-slate-100 hover:text-foreground",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className={cn("h-4 w-4", active && "text-brand-red")} />
                      {item.label}
                    </span>
                    {item.badge && <Badge variant="muted" className="text-[10px]">{item.badge}</Badge>}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="rounded-lg p-3 bg-gradient-to-br from-brand-red/15 to-brand-redDark/15 border border-slate-300">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5 text-brand-red" />
            Auto-distribution
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Coming soon. New leads auto-dispersed to your account based on filters.
          </p>
        </div>
        <Link
          href="#"
          className="flex items-center gap-2 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <LifeBuoy className="h-3.5 w-3.5" />
          Support center
        </Link>
      </div>
    </aside>
  );
}
