"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

async function setUserMode(enabled: boolean) {
  const res = await fetch("/api/admin/user-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("Couldn't switch user mode");
  // Full load so every page and the session pick up the new role.
  window.location.assign(enabled ? "/dashboard" : "/admin");
}

/** Admin Console switch: see the app the way a client does. */
export function UserModeToggle() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function turnOn() {
    setBusy(true);
    setFailed(false);
    try {
      await setUserMode(true);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={false}
      disabled={busy}
      onClick={turnOn}
      title="See the app the way a client does"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
    >
      <span className={cn("relative h-4 w-7 rounded-full transition-colors", busy ? "bg-primary" : "bg-slate-300")}>
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
            busy ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      {failed ? "Try again" : "User mode"}
    </button>
  );
}

/**
 * Shown on every page while user mode is on, so the way back is always there.
 * Floats rather than sits in the layout so the page underneath matches what a
 * client gets.
 */
export function UserModeBanner() {
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  if (!session?.user?.userMode) return null;

  async function turnOff() {
    setBusy(true);
    try {
      await setUserMode(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-20 right-4 z-50 flex items-center gap-3 rounded-full border border-slate-300 bg-white py-1.5 pl-4 pr-1.5 text-sm shadow-lg lg:bottom-4">
      <span className="flex items-center gap-2 font-medium">
        <Eye className="h-4 w-4 text-primary" /> User mode
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={turnOff}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />} Back to admin
      </button>
    </div>
  );
}
