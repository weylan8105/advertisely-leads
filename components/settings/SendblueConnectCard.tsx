"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Loader2, Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Status {
  configured: boolean;
  canUse?: boolean;
  number: string | null;
  seatId: string | null;
  isAdmin?: boolean;
  webhookUrl?: string;
}

export function SendblueConnectCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [number, setNumber] = useState("");
  const [seatId, setSeatId] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/integrations/sendblue")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => {
        setStatus(d);
        setNumber(d?.number ?? "");
        setSeatId(d?.seatId ?? "");
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function save() {
    setSaving(true);
    setBanner(null);
    try {
      const r = await fetch("/api/integrations/sendblue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: number.trim() || null, seatId: seatId.trim() || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not save");
      setBanner({ ok: true, text: number.trim() ? "Texting line saved. You can now text leads from the CRM." : "Texting line cleared." });
      load();
    } catch (e: any) {
      setBanner({ ok: false, text: e.message ?? "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  // Limited rollout: only show the texting setup to users with access
  // (platform admins + members of a Goldmine-enabled team).
  if (!status || status.canUse === false) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-brand-red" />
          Texting (Sendblue)
        </CardTitle>
        <CardDescription>
          iMessage &amp; text your leads from inside the CRM. Enter the Sendblue line assigned to you —
          that&apos;s the number your leads will see.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {banner && (
          <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            banner.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>
            {banner.ok ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
            {banner.text}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        ) : status && !status.configured ? (
          <p className="text-sm text-muted-foreground">
            Texting isn&apos;t enabled on the server yet. Once the Sendblue API keys are added, you&apos;ll be
            able to set your line here.
          </p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Your Sendblue line</label>
                <input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="mt-1 w-full h-10 rounded-md border border-slate-200 px-3 text-sm focus:border-brand-red focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Seat ID (optional)</label>
                <input
                  value={seatId}
                  onChange={(e) => setSeatId(e.target.value)}
                  placeholder="Sendblue seat UUID"
                  className="mt-1 w-full h-10 rounded-md border border-slate-200 px-3 text-sm focus:border-brand-red focus:outline-none"
                />
              </div>
            </div>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save line
            </Button>

            {status?.isAdmin && status.webhookUrl && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="text-muted-foreground mb-1">
                  <span className="font-medium">Admin:</span> set this as the inbound/status webhook URL in your
                  Sendblue dashboard so replies and delivery receipts flow back in:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-white border border-slate-200 px-2 py-1 font-mono text-[11px]">
                    {status.webhookUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(status.webhookUrl!).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
