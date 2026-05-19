"use client";
import { useEffect, useState } from "react";
import { Check, Plug, Lock, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GHLConnectCard() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [locationId, setLocationId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/integrations/ghl")
      .then((r) => r.json())
      .then((data) => {
        setConnected(!!data.connected);
        if (data.locationId) setLocationId(data.locationId);
      })
      .catch(() => setConnected(false));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/integrations/ghl", {
      method: "POST",
      body: JSON.stringify({ apiKey, locationId }),
    });
    setSaving(false);
    if (res.ok) {
      setConnected(true);
      setEditing(false);
      setApiKey("");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save");
    }
  }

  async function disconnect() {
    await fetch("/api/integrations/ghl", { method: "DELETE" });
    setConnected(false);
    setLocationId("");
  }

  return (
    <Card className="p-5 flex flex-col gap-4 hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="h-10 w-10 grid place-items-center rounded-lg bg-amber-500/10 text-amber-700">
          <Plug className="h-5 w-5" />
        </div>
        {connected === null ? (
          <Badge variant="muted">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking
          </Badge>
        ) : connected ? (
          <Badge variant="success">
            <Check className="h-3 w-3 mr-1" /> Connected
          </Badge>
        ) : (
          <Badge variant="muted">Available</Badge>
        )}
      </div>
      <div>
        <div className="font-semibold tracking-tight">GoHighLevel</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Push purchased leads directly into your GHL pipeline. Generate your API key in GHL
          Settings → Business Profile.
        </p>
      </div>

      {!editing && !connected && (
        <Button size="sm" className="w-fit" onClick={() => setEditing(true)}>
          Connect GHL
        </Button>
      )}

      {!editing && connected && (
        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">
            Location: <span className="font-mono">{locationId || "—"}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Update credentials
            </Button>
            <Button size="sm" variant="ghost" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div className="space-y-1.5">
            <Label>Location ID</Label>
            <Input
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="Your GHL Location ID"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste GHL API key"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> Stored encrypted at rest. Never displayed back.
            </p>
          </div>
          {error && <p className="text-[11px] text-rose-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !locationId || !apiKey}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save & connect
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
