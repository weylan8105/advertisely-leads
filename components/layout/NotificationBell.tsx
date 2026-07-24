"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell, ShoppingCart, RefreshCw } from "lucide-react";
import { useSession } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Notification {
  id: string;
  type: "purchase" | "replacement";
  title: string;
  body: string;
  at: string;
  href: string;
}

const SEEN_KEY = "advertisely.notifications.lastSeen";

export function NotificationBell() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "ADMIN";

  const [items, setItems] = useState<Notification[]>([]);
  const [lastSeen, setLastSeen] = useState<number>(0);
  const [open, setOpen] = useState(false);

  // Load the last-seen marker from localStorage on mount.
  useEffect(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(SEEN_KEY) : null;
    setLastSeen(v ? Number(v) : 0);
  }, []);

  const load = useCallback(() => {
    if (!isAdmin) return;
    fetch("/api/admin/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.notifications && setItems(d.notifications))
      .catch(() => {});
  }, [isAdmin]);

  // Poll every 60s so new purchases surface without a refresh.
  useEffect(() => {
    if (!isAdmin) return;
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [isAdmin, load]);

  const unread = items.filter((n) => new Date(n.at).getTime() > lastSeen).length;

  function markSeen() {
    const now = Date.now();
    setLastSeen(now);
    if (typeof window !== "undefined") window.localStorage.setItem(SEEN_KEY, String(now));
  }

  // Non-admins get the plain (decorative) bell — no admin feed.
  if (!isAdmin) {
    return (
      <button className="relative h-9 w-9 grid place-items-center rounded-md border border-slate-300 hover:bg-slate-100">
        <Bell className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) markSeen();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button className="relative h-9 w-9 grid place-items-center rounded-md border border-slate-300 hover:bg-slate-100">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 grid place-items-center rounded-full bg-brand-red text-white text-[10px] font-semibold">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
          <span className="text-sm font-semibold">Notifications</span>
          {items.length > 0 && (
            <span className="text-[11px] text-muted-foreground">{items.length} recent</span>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </div>
          ) : (
            items.map((n) => {
              const isNew = new Date(n.at).getTime() > lastSeen;
              return (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="flex gap-3 px-3 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <div
                    className={`h-8 w-8 shrink-0 grid place-items-center rounded-full ${
                      n.type === "purchase"
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-amber-500/15 text-amber-600"
                    }`}
                  >
                    {n.type === "purchase" ? (
                      <ShoppingCart className="h-4 w-4" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold">{n.title}</span>
                      {isNew && <span className="h-1.5 w-1.5 rounded-full bg-brand-red" />}
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(n.at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
