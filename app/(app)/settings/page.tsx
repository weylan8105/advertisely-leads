import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRMIntegrationCard } from "@/components/settings/CRMIntegrationCard";
import { integrations } from "@/data/integrations";
import { currentUser } from "@/data/user";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Webhook, FileSpreadsheet, Eye, Copy } from "lucide-react";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Account & integrations"
        description="Manage your profile, agency, CRM destinations, exports, and notifications."
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="agency">Agency</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="export">Exports</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Your profile</CardTitle>
              <CardDescription>
                Used for lead assignment, CRM attribution, and outreach signature.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input defaultValue={currentUser.name} />
              </div>
              <div className="space-y-1.5">
                <Label>Work email</Label>
                <Input defaultValue={currentUser.email} />
              </div>
              <div className="space-y-1.5">
                <Label>Producer license state</Label>
                <Input defaultValue={currentUser.state} />
              </div>
              <div className="space-y-1.5">
                <Label>NPN (optional)</Label>
                <Input placeholder="National Producer Number" />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button variant="outline">Cancel</Button>
                <Button>Save changes</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agency">
          <Card>
            <CardHeader>
              <CardTitle>Agency information</CardTitle>
              <CardDescription>
                Used on invoices and routed for agency-level lead distribution.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Agency name</Label>
                <Input defaultValue={currentUser.agency} />
              </div>
              <div className="space-y-1.5">
                <Label>IMO / Carrier alignment</Label>
                <Input placeholder="Global Financial Impact (GFI)" defaultValue="GFI" />
              </div>
              <div className="space-y-1.5">
                <Label>Number of producers</Label>
                <Select defaultValue="2-5">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Solo</SelectItem>
                    <SelectItem value="2-5">2–5</SelectItem>
                    <SelectItem value="6-15">6–15</SelectItem>
                    <SelectItem value="16+">16+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>States licensed</Label>
                <Input placeholder="TX, FL, OH, GA" defaultValue="TX, FL, OH, GA" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-base font-semibold">CRM destinations</h3>
                  <p className="text-xs text-muted-foreground">
                    Connect your CRM to push leads automatically as they arrive.
                  </p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {integrations.map((i) => (
                  <CRMIntegrationCard key={i.id} integration={i} />
                ))}
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-brand-teal" />
                  Custom webhook endpoint
                </CardTitle>
                <CardDescription>
                  POST every new lead to your URL. Signed with HMAC-SHA256 using your secret.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Webhook URL</Label>
                  <div className="flex gap-2">
                    <Input placeholder="https://your-app.com/webhooks/advertisely" />
                    <Button variant="outline">Test</Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Signing secret</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      defaultValue="whsec_abc123••••••••••••••"
                      className="font-mono"
                    />
                    <Button variant="outline">
                      <Eye className="h-4 w-4" /> Reveal
                    </Button>
                    <Button variant="outline">
                      <Copy className="h-4 w-4" /> Copy
                    </Button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button>Save webhook</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-300" />
                  Google Sheets connection
                </CardTitle>
                <CardDescription>
                  Auto-append new leads to a connected sheet. Shared visibility for your agency.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">advertisely-leads-pace-agency</div>
                    <div className="text-xs text-muted-foreground">
                      Connected · last sync 2 minutes ago
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="success">Connected</Badge>
                    <Button size="sm" variant="outline">
                      Disconnect
                    </Button>
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Connect another sheet
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle>Export preferences</CardTitle>
              <CardDescription>
                Default fields, file format, and consent metadata behavior.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Default format</Label>
                  <Select defaultValue="csv">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Date format</Label>
                  <Select defaultValue="iso">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="iso">ISO 8601</SelectItem>
                      <SelectItem value="us">MM/DD/YYYY</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Include in export</Label>
                {[
                  "TCPA consent certificate URL",
                  "TrustedForm / Jornaya token",
                  "IP address & opt-in timestamp",
                  "Meta campaign / ad set / creative IDs",
                  "Internal notes",
                ].map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <Checkbox defaultChecked />
                    {f}
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <Button>Save preferences</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification preferences</CardTitle>
              <CardDescription>How we ping you when something happens.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ["New lead delivered", true],
                ["Order delivery completed", true],
                ["Replacement approved / denied", true],
                ["Weekly performance digest", true],
                ["Marketplace inventory alerts", false],
              ].map(([label, on]) => (
                <div key={label as string} className="flex items-center justify-between border-b border-white/[0.06] pb-3 last:border-0">
                  <div className="text-sm">{label}</div>
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1 text-xs"><Checkbox defaultChecked={!!on} /> Email</label>
                    <label className="flex items-center gap-1 text-xs"><Checkbox defaultChecked={!!on} /> SMS</label>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
