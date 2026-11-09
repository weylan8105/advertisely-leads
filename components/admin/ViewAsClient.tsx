"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

async function setViewAs(userId: string | null) {
  const res = await fetch("/api/admin/view-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "Couldn't switch accounts");
  }
  // Full load so every page and the session pick up the other account.
  window.location.assign(userId ? "/dashboard" : "/admin#client-box");
}

/** Client accounts row button: open this client's app, view only. */
export function ViewAsClientButton({ userId, label }: { userId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      title={`See ${label}'s dashboard exactly as they do (view only)`}
      onClick={async () => {
        setBusy(true);
        try {
          await setViewAs(userId);
        } catch (e) {
          setBusy(false);
          window.alert((e as Error).message);
        }
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} View dashboard
    </Button>
  );
}

/**
 * On every page while an admin is viewing a client's account. Floats so the
 * page underneath matches what the client gets.
 */
export function ViewAsBanner() {
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  if (!session?.user?.viewingAs) return null;
  const who = session.user.name || session.user.email || "a client";

  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-amber-300 bg-amber-50 py-1.5 pl-4 pr-1.5 text-sm text-amber-950 shadow-lg lg:bottom-4">
      <span className="flex min-w-0 items-center gap-2">
        <Eye className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="truncate">
          Viewing <strong>{who}</strong> · view only
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await setViewAs(null);
          } catch {
            setBusy(false);
          }
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />} Exit to admin
      </button>
    </div>
  );
}
