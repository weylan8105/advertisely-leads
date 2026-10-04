import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRMIntegrationCard } from "@/components/settings/CRMIntegrationCard";
import { GoogleSheetsConnectCard } from "@/components/settings/GoogleSheetsConnectCard";
import { integrations } from "@/data/integrations";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { PasswordSettings } from "@/components/settings/PasswordSettings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Webhook, Eye, Copy } from "lucide-react";

const SETTINGS_TABS = ["profile", "security", "integrations", "export", "notifications"];

export default function SettingsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const requested = searchParams?.tab;
  const initialTab = requested && SETTINGS_TABS.includes(requested) ? requested : "profile";
  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Account & integrations"
        description="Manage your profile, agency, CRM destinations, exports, and notifications."
      />

      <Tabs defaultValue={initialTab} key={initialTab}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="export">Exports</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="security">
          <PasswordSettings />
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
                {integrations
                  .filter((i) => i.type !== "sheets")
                  .map((i) => (
                    <CRMIntegrationCard key={i.id} integration={i} />
                  ))}
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-brand-red" />
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

            <GoogleSheetsConnectCard />
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
                <div key={label as string} className="flex items-center justify-between border-b border-slate-200 pb-3 last:border-0">
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
