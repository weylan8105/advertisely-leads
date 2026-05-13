import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Calendar,
  ShieldCheck,
  RefreshCw,
  Send,
  ExternalLink,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/leads/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mockLeads, leadStatuses } from "@/data/leads";
import { formatCurrency, formatDateTime, initials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const lead = mockLeads.find((l) => l.id === params.id);
  if (!lead) return notFound();

  return (
    <div>
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to leads
      </Link>

      <PageHeader
        eyebrow={`Lead ${lead.id}`}
        title={lead.name}
        description={lead.intentReason}
        actions={
          <>
            <Button size="sm" variant="outline">
              <RefreshCw className="h-4 w-4" /> Request replacement
            </Button>
            <Button size="sm">
              <Send className="h-4 w-4" /> Push to CRM
            </Button>
          </>
        }
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
              <CardDescription>Outreach details captured at form submission</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
              <Field icon={Phone} label="Phone" value={lead.phone} />
              <Field icon={Mail} label="Email" value={lead.email} />
              <Field icon={MapPin} label="State" value={lead.state} />
              <Field icon={Briefcase} label="Occupation" value={lead.occupation} />
              <Field icon={Calendar} label="Age" value={`${lead.age}`} />
              <Field icon={Calendar} label="Self-reported income" value={formatCurrency(lead.income)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Intent & qualification</CardTitle>
              <CardDescription>What the prospect actually asked about</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">IUL interest reason</div>
                <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 text-sm">
                  {lead.intentReason}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">{lead.leadTypeLabel}</Badge>
                <Badge variant="muted">{lead.source}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes & activity</CardTitle>
              <CardDescription>Internal CRM timeline. Visible to your agency seats only.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 mb-4">
                <Textarea placeholder="Add a note about this lead…" />
                <div className="flex justify-end">
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5" /> Add note
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {lead.notes.length === 0 && (
                  <div className="rounded-md border border-dashed border-white/10 bg-white/[0.01] p-4 text-xs text-muted-foreground text-center">
                    No notes yet. Add the first one above.
                  </div>
                )}
                {lead.notes.map((n) => (
                  <div key={n.id} className="flex items-start gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-[10px]">{initials(n.author)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium">{n.author}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDateTime(n.at)}
                        </div>
                      </div>
                      <p className="mt-1 text-sm">{n.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Update where this lead sits in your pipeline.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={lead.status} />
                <span className="text-xs text-muted-foreground">
                  Last updated {formatDateTime(lead.receivedAt)}
                </span>
              </div>
              <Select defaultValue={lead.status}>
                <SelectTrigger>
                  <SelectValue placeholder="Update status" />
                </SelectTrigger>
                <SelectContent>
                  {leadStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button className="w-full" size="sm">
                Save status
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Consent record</CardTitle>
              <CardDescription>TCPA opt-in proof preserved on this lead</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-brand-teal" />
                <Badge variant="success">{lead.consent.method}</Badge>
              </div>
              <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Captured</span>
                  <span>{lead.consent.captured ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timestamp</span>
                  <span>{formatDateTime(lead.consent.timestamp)}</span>
                </div>
                {lead.consent.ip && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IP</span>
                    <span className="font-mono">{lead.consent.ip}</span>
                  </div>
                )}
              </div>
              <Button variant="outline" size="sm" className="w-full">
                <ExternalLink className="h-3.5 w-3.5" /> View consent certificate
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Source campaign</CardTitle>
              <CardDescription>Where this lead originated</CardDescription>
            </CardHeader>
            <CardContent className="text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform</span>
                <span>Meta Ads</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Campaign</span>
                <span className="text-right">{lead.source}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ad set</span>
                <span className="font-mono">AS-{lead.id.slice(-4)}-A</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Creative ID</span>
                <span className="font-mono">CR-{lead.id.slice(-4)}-02</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-[10px]">
                    {initials(lead.assignedAgent ?? "Unassigned")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium">{lead.assignedAgent ?? "Unassigned"}</div>
                  <div className="text-xs text-muted-foreground">Agent</div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full">
                Reassign agent
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
