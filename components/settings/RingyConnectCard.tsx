"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, Loader2 } from "lucide-react";
import { RingyKeysModal } from "@/components/RingyKeysModal";

interface Status {
  connected: boolean;
  show: boolean;
  lastUsedAt: string | null;
}

/**
 * Settings → Integrations: the user's own Ringy CRM. Connect or replace their
 * API keys, send a test lead, or unlink. Shown to advertisers and to anyone
 * whose Ringy is already connected (e.g. an upline linked it for them).
 */
export function RingyConnectCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    fetch("/api/integrations/ringy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => setStatus(d))
      .catch(() => setStatus(null));
  };
  useEffect(load, []);

  async function unlink() {
    if (!window.confirm("Unlink your Ringy? New leads will stop going to your Ringy CRM until you connect it again.")) return;
    setUnlinking(true);
    setMsg(null);
    const r = await fetch("/api/integrations/ringy", { method: "DELETE" }).catch(() => null);
    setUnlinking(false);
    setMsg(r?.ok ? "Ringy unlinked. Connect new keys any time." : "Couldn't unlink. Try again.");
    load();
  }

  if (!status?.show) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-sky-600" />
          Ringy CRM
          {status.connected && (
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              Connected
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Your campaign leads also go straight into your Ringy dialer. Use your Ringy API SID and Auth Token. If you
          get a new API connector from Ringy, unlink the old one and connect the new keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>
            {status.connected ? "Replace keys / send test" : "Connect Ringy"}
          </Button>
          {status.connected && (
            <Button size="sm" variant="outline" onClick={unlink} disabled={unlinking} className="text-rose-600 hover:text-rose-700">
              {unlinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Unlink Ringy
            </Button>
          )}
        </div>
        {status.connected && status.lastUsedAt && (
          <p className="text-xs text-muted-foreground">Last lead sent {new Date(status.lastUsedAt).toLocaleString()}.</p>
        )}
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      </CardContent>
      {open && (
        <RingyKeysModal
          userId=""
          name="your account"
          connected={status.connected}
          endpoint="/api/integrations/ringy"
          description="Leads delivered to you will also be sent into this Ringy account."
          onClose={(changed) => { setOpen(false); if (changed) load(); }}
        />
      )}
    </Card>
  );
}
