"use client";
import { useEffect, useState } from "react";
import { Plus, Plug, ExternalLink, Copy, SlidersHorizontal, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FieldMappingDialog } from "@/components/admin/FieldMappingDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leadPackages } from "@/data/packages";

export function MetaIntegrationManager() {
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPage, setShowAddPage] = useState(false);
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageToken, setPageToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load already-connected pages from the DB on mount. Without this, connecting
  // a page and refreshing made it (and its form mappings) disappear from view.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/meta/pages");
        if (res.ok && active) {
          const { pages: loaded } = await res.json();
          setPages(loaded ?? []);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/meta`
      : "https://advertisely.io/api/webhooks/meta";

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Webhook configuration</CardTitle>
          <CardDescription>
            Use these values in your Meta App's Webhook configuration screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <Label className="mb-1.5 block">Callback URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">Verify Token</Label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Set <code className="font-mono">META_VERIFY_TOKEN</code> in Vercel env vars to any
              random string, then paste the same string here in Meta App settings.
            </p>
          </div>
          <a
            href="https://developers.facebook.com/docs/marketing-api/guides/lead-ads/setup/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-red hover:underline"
          >
            Meta Lead Ads webhook docs <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Connected Meta pages</CardTitle>
            <CardDescription>
              One page = one source of leads. Each form on a page maps to one Advertisely package.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAddPage(!showAddPage)}>
            <Plus className="h-3.5 w-3.5" />
            Add page
          </Button>
        </CardHeader>
        <CardContent>
          {showAddPage && (
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 mb-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Page ID</Label>
                  <Input
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    placeholder="123456789012345"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Page name</Label>
                  <Input
                    value={pageName}
                    onChange={(e) => setPageName(e.target.value)}
                    placeholder="Advertisely Leads FB Page"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Page Access Token (long-lived)</Label>
                <Input
                  type="password"
                  value={pageToken}
                  onChange={(e) => setPageToken(e.target.value)}
                  placeholder="EAA…"
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Generate via Graph API Explorer or Token Debugger →{" "}
                  <code>pages_read_engagement</code>, <code>leads_retrieval</code>,
                  <code>pages_show_list</code> scopes.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddPage(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    setSaveError(null);
                    try {
                      const res = await fetch("/api/admin/meta/pages", {
                        method: "POST",
                        body: JSON.stringify({ pageId, pageName, pageAccessToken: pageToken }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        setSaveError(data?.error ?? "Failed to connect page.");
                        return;
                      }
                      // Replace an existing page with the same id, otherwise append.
                      setPages((prev) => [
                        data.page,
                        ...prev.filter((p) => p.pageId !== data.page.pageId),
                      ]);
                      setPageId("");
                      setPageName("");
                      setPageToken("");
                      setShowAddPage(false);
                    } catch {
                      setSaveError("Network error connecting page.");
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? "Connecting…" : "Save page"}
                </Button>
              </div>
              {saveError && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-muted-foreground">
              Loading connected pages…
            </div>
          ) : pages.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <Plug className="h-6 w-6 mx-auto text-brand-red mb-2" />
              <div className="text-sm font-medium">No pages connected yet.</div>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Connect your first Meta page above. Leads from any form on that page will start
                flowing into Advertisely the moment a prospect submits.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pages.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{p.pageName}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        Page ID: {p.pageId}
                      </div>
                    </div>
                    <Badge variant={p.enabled ? "success" : "muted"}>
                      {p.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  {p.subscribedAt ? (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Subscribed to leadgen — leads will flow to mapped forms.
                    </div>
                  ) : (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Not subscribed to leadgen — Meta will send no leads yet.
                        {p.subscriptionError ? ` (${p.subscriptionError})` : ""} Re-save the
                        page token with <code className="font-mono">leads_retrieval</code> +{" "}
                        <code className="font-mono">pages_manage_metadata</code> scopes to fix.
                      </span>
                    </div>
                  )}
                  <FormMappingList pageConnectionId={p.id} mappings={p.formMappings ?? []} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SimulateLeadCard />
    </div>
  );
}

function SimulateLeadCard() {
  const [pkg, setPkg] = useState<string>(leadPackages[0].id);
  const [name, setName] = useState("Test Prospect");
  const [phone, setPhone] = useState("+15555550123");
  const [state, setState] = useState("FL");
  const [email, setEmail] = useState("test@example.com");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { ok: boolean; message: string; delivered?: boolean } | null
  >(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test the pipeline</CardTitle>
        <CardDescription>
          Fire a synthetic lead through the real ingest + fulfillment path (no
          live Meta app needed) to confirm matching, delivery email, and Sheets
          sync all work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Package</Label>
            <Select value={pkg} onValueChange={setPkg}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leadPackages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>State (2-letter or full name)</Label>
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              try {
                const res = await fetch("/api/admin/meta/simulate", {
                  method: "POST",
                  body: JSON.stringify({
                    packageId: pkg,
                    name,
                    phone,
                    state,
                    email,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  setResult({ ok: false, message: data?.error ?? "Failed." });
                } else {
                  setResult({
                    ok: true,
                    message: data.message,
                    delivered: data.delivered,
                  });
                }
              } catch {
                setResult({ ok: false, message: "Network error." });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending…" : "Send test lead"}
          </Button>
        </div>
        {result && (
          <div
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
              result.ok
                ? result.delivered
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {result.ok && result.delivered ? (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            )}
            <span>{result.message}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FormMappingList({
  pageConnectionId,
  mappings: initial,
}: {
  pageConnectionId: string;
  mappings: any[];
}) {
  const [mappings, setMappings] = useState(initial);
  const [show, setShow] = useState(false);
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [packageId, setPackageId] = useState<string>(leadPackages[0].id);
  const [configForm, setConfigForm] = useState<any | null>(null);

  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-muted-foreground">
          Form → Package mappings ({mappings.length})
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShow(!show)}>
          <Plus className="h-3 w-3" /> Add form
        </Button>
      </div>

      {show && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 mb-2 space-y-2">
          <div className="grid sm:grid-cols-3 gap-2">
            <Input
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              placeholder="Meta form ID"
              className="text-xs"
            />
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Form name"
              className="text-xs"
            />
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leadPackages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShow(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                const res = await fetch("/api/admin/meta/forms", {
                  method: "POST",
                  body: JSON.stringify({
                    pageConnectionId,
                    formId,
                    formName,
                    packageId,
                  }),
                });
                if (res.ok) {
                  const { mapping } = await res.json();
                  setMappings([...mappings, mapping]);
                  setShow(false);
                }
              }}
            >
              Map form
            </Button>
          </div>
        </div>
      )}

      {mappings.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          No forms mapped. Map at least one form before leads can flow in.
        </p>
      ) : (
        <div className="space-y-1.5">
          {mappings.map((m) => {
            const pkg = leadPackages.find((p) => p.id === m.packageId);
            return (
              <div
                key={m.id}
                className="flex items-center justify-between text-xs rounded-md bg-slate-50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.formName}</span>
                  <span className="text-muted-foreground">→</span>
                  <Badge variant="muted" className="text-[10px]">
                    {pkg?.name ?? m.packageId}
                  </Badge>
                  {(() => {
                    const mapped = Object.keys((m.fieldMapping as Record<string, string>) ?? {}).length;
                    return (
                      <Badge variant={mapped > 0 ? "info" : "warning"} className="text-[10px]">
                        {mapped > 0 ? `${mapped} field${mapped > 1 ? "s" : ""} mapped` : "no custom mapping"}
                      </Badge>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setConfigForm(m)}
                  >
                    <SlidersHorizontal className="h-3 w-3" /> Configure fields
                  </Button>
                  <Badge variant={m.enabled ? "success" : "muted"} className="text-[10px]">
                    {m.enabled ? "Active" : "Off"}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {configForm && (
        <FieldMappingDialog
          open={!!configForm}
          onOpenChange={(o) => !o && setConfigForm(null)}
          mapping={{
            id: configForm.id,
            formId: configForm.formId,
            formName: configForm.formName,
            packageId: configForm.packageId,
            pageConnectionId,
          }}
        />
      )}
    </div>
  );
}
