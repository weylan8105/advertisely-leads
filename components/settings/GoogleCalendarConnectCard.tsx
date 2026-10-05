"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Status {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

const RESULT_MSG: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google Calendar connected. New callbacks will sync automatically." },
  denied: { ok: false, text: "Connection cancelled — access was not granted." },
  norefresh: { ok: false, text: "Google didn't return offline access. Try again and tap Allow." },
  unconfigured: { ok: false, text: "Calendar isn't set up on the server yet (Google Cloud step pending)." },
  error: { ok: false, text: "Something went wrong connecting your calendar. Please try again." },
};

export function GoogleCalendarConnectCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/integrations/google-calendar")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Surface the OAuth redirect result (?calendar=...), then clean the URL.
    try {
      const p = new URLSearchParams(window.location.search);
      const r = p.get("calendar");
      if (r && RESULT_MSG[r]) {
        setBanner(RESULT_MSG[r]);
        p.delete("calendar");
        const qs = p.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
    } catch {}
  }, []);

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/integrations/google-calendar", { method: "DELETE" });
      setBanner({ ok: true, text: "Google Calendar disconnected." });
      load();
    } catch {
      setBanner({ ok: false, text: "Could not disconnect. Please try again." });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-brand-red" />
          Google Calendar
        </CardTitle>
        <CardDescription>
          Auto-add an event to your calendar whenever you set a callback reminder on a lead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {banner && (
          <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            banner.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>
            {banner.ok ? <Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />}
            {banner.text}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking connection…
          </div>
        ) : status?.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <Check className="h-4 w-4" /> Connected
              </span>
              {status.email && <span className="text-muted-foreground"> · {status.email}</span>}
            </div>
            <Button variant="outline" size="sm" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Disconnect
            </Button>
          </div>
        ) : status && !status.configured ? (
          <p className="text-sm text-muted-foreground">
            Calendar sync isn&apos;t enabled on the server yet. Once the Google Calendar API is turned on
            for Advertisely, a Connect button will appear here.
          </p>
        ) : (
          <a href="/api/integrations/google-calendar/connect">
            <Button size="sm">
              <CalendarCheck className="h-4 w-4" /> Connect Google Calendar
            </Button>
          </a>
        )}
      </CardContent>
    </Card>
  );
}
