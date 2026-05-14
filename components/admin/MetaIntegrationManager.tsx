"use client";
import { useState } from "react";
import { Plus, Plug, ExternalLink, Eye, Copy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  const [showAddPage, setShowAddPage] = useState(false);
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageToken, setPageToken] = useState("");

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
            className="inline-flex items-center gap-1 text-xs text-brand-teal hover:underline"
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
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 mb-4 space-y-3">
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
                  onClick={async () => {
                    const res = await fetch("/api/admin/meta/pages", {
                      method: "POST",
                      body: JSON.stringify({ pageId, pageName, pageAccessToken: pageToken }),
                    });
                    if (res.ok) {
                      const { page } = await res.json();
                      setPages([...pages, page]);
                      setPageId("");
                      setPageName("");
                      setPageToken("");
                      setShowAddPage(false);
                    }
                  }}
                >
                  Save page
                </Button>
              </div>
            </div>
          )}

          {pages.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/10 bg-white/[0.01] p-8 text-center">
              <Plug className="h-6 w-6 mx-auto text-brand-teal mb-2" />
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
                  className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4"
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
                  <FormMappingList pageConnectionId={p.id} mappings={p.formMappings ?? []} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-muted-foreground">
          Form → Package mappings ({mappings.length})
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShow(!show)}>
          <Plus className="h-3 w-3" /> Add form
        </Button>
      </div>

      {show && (
        <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-3 mb-2 space-y-2">
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
                className="flex items-center justify-between text-xs rounded-md bg-white/[0.02] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.formName}</span>
                  <span className="text-muted-foreground">→</span>
                  <Badge variant="muted" className="text-[10px]">
                    {pkg?.name ?? m.packageId}
                  </Badge>
                </div>
                <Badge variant={m.enabled ? "success" : "muted"} className="text-[10px]">
                  {m.enabled ? "Active" : "Off"}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
