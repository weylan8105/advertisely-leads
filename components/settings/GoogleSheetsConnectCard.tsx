"use client";

import { useEffect, useState } from "react";
import {
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface Status {
  configured: boolean;
  serviceAccountEmail: string;
  connected: boolean;
  spreadsheetId?: string;
}

export function GoogleSheetsConnectCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/integrations/sheets");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't connect that sheet.");
        return;
      }
      setSheetUrl("");
      await refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/integrations/sheets", { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function copyEmail() {
    if (!status?.serviceAccountEmail) return;
    navigator.clipboard.writeText(status.serviceAccountEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  const sheetUrlFull = status?.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${status.spreadsheetId}`
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          Google Sheets — live delivery
        </CardTitle>
        <CardDescription>
          Connect a Google Sheet and every new lead is appended to it automatically, so your
          team sees leads in real time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking connection…
          </div>
        ) : !status.configured ? (
          <div className="flex items-start gap-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-brand-red" />
            Live Google Sheets delivery isn't enabled on the server yet. Once it's turned on,
            you'll be able to connect a sheet here.
          </div>
        ) : status.connected ? (
          <>
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="success">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  New leads are appended to your sheet automatically as they're delivered.
                </p>
              </div>
              {sheetUrlFull && (
                <a
                  href={sheetUrlFull}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-brand-red hover:underline"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Disconnect sheet
            </Button>
          </>
        ) : (
          <>
            <ol className="space-y-2.5 text-sm">
              <li className="flex gap-2.5">
                <span className="font-semibold text-brand-red">1.</span>
                <span>Create (or open) the Google Sheet you want your leads to land in.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-semibold text-brand-red">2.</span>
                <span>
                  In that sheet, click <strong>Share</strong> and add this address as an{" "}
                  <strong>Editor</strong>:
                  <span className="mt-1.5 flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded-md bg-slate-100 border border-slate-200 px-2.5 py-1.5 text-xs font-mono">
                      {status.serviceAccountEmail}
                    </code>
                    <button
                      onClick={copyEmail}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs hover:border-brand-red hover:text-brand-red"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy
                        </>
                      )}
                    </button>
                  </span>
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-semibold text-brand-red">3.</span>
                <span>Paste the sheet's link below and connect.</span>
              </li>
            </ol>

            <div className="space-y-1.5">
              <Label htmlFor="sheet-url">Google Sheet link</Label>
              <div className="flex gap-2">
                <Input
                  id="sheet-url"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                />
                <Button onClick={connect} disabled={busy || !sheetUrl.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Connect
                </Button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
