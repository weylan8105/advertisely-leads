"use client";

import { useState } from "react";
import { Link2 as LinkIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Enter, replace or remove someone's Ringy API keys (lib/ringy.ts). Used by
 * admins on Client accounts (/api/admin/accounts/ringy) and by team managers
 * who have Ringy themselves, for their downlines (/api/team/ringy). Both
 * endpoints take POST { userId, sid, authToken } and DELETE { userId }.
 */
export function RingyKeysModal({
  userId,
  name,
  connected,
  endpoint,
  description,
  onClose,
}: {
  userId: string;
  name: string;
  connected: boolean;
  endpoint: string;
  description: string;
  onClose: (changed: boolean) => void;
}) {
  const [sid, setSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [busy, setBusy] = useState<"save" | "disconnect" | "test" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function sendTest() {
    setBusy("test"); setErr(null); setTestMsg(null);
    try {
      const res = await fetch("/api/integrations/ringy/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const d = await res.json().catch(() => ({}));
      setTestMsg(
        d.ok
          ? { ok: true, text: `Test lead sent. Ringy accepted it${d.vendorResponseId ? ` (ref ${d.vendorResponseId})` : ""}. Look for "Advertisely Test Lead (delete me)" in Ringy.` }
          : { ok: false, text: `Ringy didn't take the test lead: ${d.error ?? `HTTP ${res.status}`}` },
      );
    } catch (e: any) {
      setTestMsg({ ok: false, text: e?.message ?? "Couldn't send the test lead." });
    } finally {
      setBusy(null);
    }
  }

  async function send(method: "POST" | "DELETE", body: Record<string, string>) {
    const res = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  }

  async function save() {
    if (!sid.trim() || !authToken.trim()) { setErr("Both the SID and Auth Token are required."); return; }
    setBusy("save"); setErr(null);
    try {
      await send("POST", { userId, sid: sid.trim(), authToken: authToken.trim() });
      onClose(true);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't save."); setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect Ringy for ${name}? New leads will stop forwarding to their Ringy CRM.`)) return;
    setBusy("disconnect"); setErr(null);
    try {
      await send("DELETE", { userId });
      onClose(true);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't disconnect."); setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => onClose(false)} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-1.5">
              <LinkIcon className="h-4 w-4 text-sky-600" /> Ringy CRM — {name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
          <button onClick={() => onClose(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {connected && (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
              Ringy is connected. Enter new keys below to replace them, or disconnect.
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-foreground">SID</label>
            <input
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              placeholder="Ringy API SID"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground">Auth Token</label>
            <input
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Ringy API Auth Token"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          {testMsg && (
            <p className={testMsg.ok ? "text-xs text-emerald-700" : "text-xs text-rose-600"}>{testMsg.text}</p>
          )}
          <div className="flex items-center justify-between pt-1">
            {connected ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={disconnect} disabled={!!busy} className="text-rose-600 hover:text-rose-700">
                  {busy === "disconnect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Disconnect
                </Button>
                <Button size="sm" variant="outline" onClick={sendTest} disabled={!!busy}>
                  {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Send test lead
                </Button>
              </div>
            ) : <span />}
            <Button size="sm" onClick={save} disabled={!!busy}>
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {connected ? "Replace keys" : "Connect Ringy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
