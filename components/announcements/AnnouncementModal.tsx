"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Check, ArrowRight, Loader2 } from "lucide-react";
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
  // The button's own action (e.g. switch Nurse leads on): working / done / failed.
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // CTA: run the announcement's action first (if any), then close and go.
  async function cta() {
    if (!item) return;
    const action = item.ctaAction;
    if (!action) return dismiss(item.ctaHref);
    if (done) return dismiss(item.ctaHref);
    setActing(true);
    setActionError(null);
    try {
      if (action.kind === "enable-lead-type") {
        const r = await fetch("/api/advertiser/lead-types", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable: action.leadType }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d.enabled) || !d.enabled.includes(action.leadType)) {
          throw new Error(d.error ?? "Couldn't turn them on. Try again, or use Lead types on your dashboard.");
        }
        // Tell an open Lead types card to show the new state.
        window.dispatchEvent(new CustomEvent("advertisely:lead-types", { detail: d }));
      }
      setDone(true);
    } catch (e: any) {
      setActionError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setActing(false);
    }
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => dismiss()} />
      <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Accent header */}
        <div className="bg-gradient-to-r from-brand-red to-brand-redDark px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{item.eyebrow ?? "New feature"}</div>
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

          {item.breakdown && (
            <div className="mt-4 rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <tbody>
                  {item.breakdown.rows.map((r) => (
                    <tr key={r.label} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 align-top">
                        <div className="text-foreground">{r.label}</div>
                        {r.detail && <div className="text-[11px] text-muted-foreground">{r.detail}</div>}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-medium tabular-nums">{r.amount}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="px-3 py-2 font-semibold">{item.breakdown.totalLabel}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{item.breakdown.total}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {item.breakdown?.footnote && <p className="mt-2 text-[11px] text-muted-foreground">{item.breakdown.footnote}</p>}

          {done && item.ctaAction && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{item.ctaAction.doneText}</span>
            </div>
          )}
          {actionError && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{actionError}</div>
          )}

          <div className="mt-6 flex items-center justify-end gap-2">
            {done ? (
              <Button size="sm" onClick={() => dismiss()}>
                Done
              </Button>
            ) : (
              <>
                {!item.noSecondary && (
                  <Button variant="outline" size="sm" onClick={() => dismiss()} disabled={acting}>
                    Maybe later
                  </Button>
                )}
                <Button size="sm" onClick={cta} disabled={acting}>
                  {acting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {item.ctaLabel}
                  {item.ctaHref && !item.ctaAction && <ArrowRight className="h-4 w-4" />}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
