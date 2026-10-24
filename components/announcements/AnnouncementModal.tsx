"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Announcement } from "@/data/announcements";

/**
 * Shows each one-time announcement exactly once per user. Fetches the caller's
 * pending announcements after login; on dismiss (or the CTA) it marks the
 * announcement seen so it never shows again (persisted per account).
 */
export function AnnouncementModal() {
  const router = useRouter();
  const [item, setItem] = useState<Announcement | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/announcements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && Array.isArray(d?.pending) && d.pending.length) setItem(d.pending[0]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function dismiss(navigateTo?: string) {
    if (closing) return;
    setClosing(true);
    const key = item?.key;
    setItem(null);
    // Persist "seen" so it never shows again; best-effort.
    try {
      if (key) {
        await fetch("/api/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
      }
    } catch {
      /* ignore — worst case it reappears next login */
    }
    if (navigateTo) {
      // External/static files (e.g. a hosted PDF) open in a new tab; in-app
      // routes use the client router.
      if (/^https?:\/\//.test(navigateTo) || /\.[a-z0-9]{2,4}$/i.test(navigateTo)) {
        window.open(navigateTo, "_blank", "noopener,noreferrer");
      } else {
        router.push(navigateTo);
      }
    }
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => dismiss()} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Accent header */}
        <div className="bg-gradient-to-r from-brand-red to-brand-redDark px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">New feature</div>
            <button onClick={() => dismiss()} className="text-white/70 hover:text-white" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{item.title}</h2>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-foreground">{item.body}</p>

          {item.highlights && item.highlights.length > 0 && (
            <ul className="mt-4 space-y-2">
              {item.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => dismiss()}>
              Maybe later
            </Button>
            <Button size="sm" onClick={() => dismiss(item.ctaHref)}>
              {item.ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
