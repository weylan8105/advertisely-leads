"use client";

import { useState } from "react";
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
  MessageSquare,
  Tag,
  Clock,
  Pencil,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/leads/StatusBadge";
import { ActivityTimeline } from "@/components/leads/ActivityTimeline";
import { TaskList } from "@/components/leads/TaskList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mockLeads, leadStatuses, dispositionLabels } from "@/data/leads";
import { formatCurrency, formatDateTime, initials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}
let toastCounter = 0;

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const lead = mockLeads.find((l) => l.id === params.id);
  if (!lead) return notFound();
  return <LeadDetailContent lead={lead} />;
}

function LeadDetailContent({ lead }: { lead: (typeof mockLeads)[number] }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ghlLoading, setGhlLoading] = useState(false);
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [statusValue, setStatusValue] = useState(lead.status);
  const [dispositionValue, setDispositionValue] = useState(lead.disposition ?? "none");
  const [statusSaving, setStatusSaving] = useState(false);

  const telHref = `tel:${lead.phone.replace(/\D/g, "")}`;
  const smsHref = `sms:${lead.phone.replace(/\D/g, "")}`;
  const mailHref = `mailto:${lead.email}`;

  function addToast(type: "success" | "error", message: string) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function pushToGHL() {
    setGhlLoading(true);
    try {
      const res = await fetch("/api/exports/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: [lead.id] }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast("error", data.error ?? "Failed to push to GoHighLevel.");
      } else {
        addToast("success", `${lead.name} pushed to GoHighLevel successfully.`);
      }
    } catch {
      addToast("error", "Failed to push to GoHighLevel. Check your GHL connection in Settings.");
    } finally {
      setGhlLoading(false);
    }
  }

  async function requestReplacement() {
    setReplacementLoading(true);
    // Simulate a brief async action — in production this would call /api/admin/replacements
    await new Promise((r) => setTimeout(r, 600));
    addToast(
      "success",
      `Replacement request submitted for ${lead.name}. Our team will review within 72 hours.`,
    );
    setReplacementLoading(false);
  }

  return (
    <div>
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg bg-white ${
                t.type === "success"
                  ? "border-emerald-200 text-emerald-800"
                  : "border-rose-200 text-rose-800"
              }`}
            >
              {t.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-rose-600" />
              )}
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismissToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to leads
      </Link>

      <PageHeader
        eyebrow={`Lead ${lead.id} · ${lead.callAttempts} call attempt${lead.callAttempts === 1 ? "" : "s"}`}
        title={lead.name}
        description={lead.intentReason}
        actions={
          <>
            <a href={telHref}>
              <Button size="sm" variant="outline">
                <Phone className="h-4 w-4" /> Call
              </Button>
            </a>
            <a href={smsHref}>
              <Button size="sm" variant="outline">
                <MessageSquare className="h-4 w-4" /> Text
              </Button>
            </a>
            <a href={mailHref}>
              <Button size="sm" variant="outline">
                <Mail className="h-4 w-4" /> Email
              </Button>
            </a>
            <Button size="sm" onClick={pushToGHL} disabled={ghlLoading}>
              {ghlLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Push to CRM
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
              <ContactField icon={Phone} label="Phone" value={lead.phone} href={telHref} />
              <ContactField icon={Mail} label="Email" value={lead.email} href={mailHref} />
              <ContactField icon={MapPin} label="State" value={lead.state} />
              <ContactField icon={Briefcase} label="Occupation" value={lead.occupation} />
              <ContactField icon={Calendar} label="Age" value={`${lead.age}`} />
              <ContactField
                icon={Calendar}
                label="Self-reported income"
                value={formatCurrency(lead.income)}
              />
              {lead.lastContactedAt && (
                <ContactField
                  icon={Clock}
                  label="Last contacted"
                  value={formatDateTime(lead.lastContactedAt)}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Tags</CardTitle>
                <CardDescription>Quick categorization across your pipeline</CardDescription>
              </div>
              <Button size="sm" variant="outline">
                <Tag className="h-3.5 w-3.5" />
                Add tag
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {lead.tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">No tags yet.</span>
                )}
                {lead.tags.map((t) => (
                  <Badge key={t} variant="default" className="cursor-pointer">
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">
                Activity ({lead.activity.length + lead.notes.length})
              </TabsTrigger>
              <TabsTrigger value="tasks">
                Tasks ({lead.tasks.filter((t) => !t.done).length})
              </TabsTrigger>
              <TabsTrigger value="notes">Notes ({lead.notes.length})</TabsTrigger>
              <TabsTrigger value="intent">Intent</TabsTrigger>
            </TabsList>

            <TabsContent value="activity">
              <Card>
                <CardHeader>
                  <CardTitle>Activity timeline</CardTitle>
                  <CardDescription>
                    Combined feed of calls, texts, emails, notes, exports, and status changes.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-5 grid grid-cols-3 gap-2">
                    <a
                      href={telHref}
                      className="flex flex-col items-center gap-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-emerald-500/[0.05] hover:border-emerald-500/30 py-3 transition-colors"
                    >
                      <Phone className="h-4 w-4 text-emerald-600" />
                      <span className="text-[11px]">Log call</span>
                    </a>
                    <a
                      href={smsHref}
                      className="flex flex-col items-center gap-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-sky-500/[0.05] hover:border-sky-500/30 py-3 transition-colors"
                    >
                      <MessageSquare className="h-4 w-4 text-sky-600" />
                      <span className="text-[11px]">Send SMS</span>
                    </a>
                    <a
                      href={mailHref}
                      className="flex flex-col items-center gap-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-violet-500/[0.05] hover:border-violet-500/30 py-3 transition-colors"
                    >
                      <Mail className="h-4 w-4 text-violet-600" />
                      <span className="text-[11px]">Send email</span>
                    </a>
                  </div>
                  <ActivityTimeline activity={lead.activity} notes={lead.notes} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tasks">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Tasks & follow-ups</CardTitle>
                    <CardDescription>
                      Schedule callbacks, send templates, and never let a lead go cold.
                    </CardDescription>
                  </div>
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    Add task
                  </Button>
                </CardHeader>
                <CardContent>
                  <TaskList tasks={lead.tasks} showLead={false} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notes">
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                  <CardDescription>
                    Internal CRM notes. Visible to your agency seats only.
                  </CardDescription>
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
                      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-muted-foreground text-center">
                        No notes yet. Add the first one above.
                      </div>
                    )}
                    {lead.notes.map((n) => (
                      <div key={n.id} className="flex items-start gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-[10px]">
                            {initials(n.author)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 rounded-md border border-slate-200 bg-slate-50 p-3">
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
            </TabsContent>

            <TabsContent value="intent">
              <Card>
                <CardHeader>
                  <CardTitle>Intent & full form responses</CardTitle>
                  <CardDescription>
                    Every question the prospect answered on the Meta instant form
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">IUL interest reason</div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                      {lead.intentReason}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="default">{lead.leadTypeLabel}</Badge>
                    <Badge variant="muted">{lead.source}</Badge>
                  </div>

                  <div className="pt-3 border-t border-slate-200">
                    <div className="text-xs font-medium mb-2">Instant form responses</div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                      <FormResponseRow label="Full name" value={lead.name} />
                      <FormResponseRow label="Phone number" value={lead.phone} />
                      <FormResponseRow label="Email" value={lead.email} />
                      <FormResponseRow label="State" value={lead.state} />
                      <FormResponseRow label="Age" value={`${lead.age}`} />
                      <FormResponseRow
                        label="Self-reported income"
                        value={formatCurrency(lead.income)}
                      />
                      <FormResponseRow label="Occupation" value={lead.occupation} />
                      <FormResponseRow label="Why interested in IUL?" value={lead.intentReason} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Sourced directly from the Meta Lead Ad form submission. Original consent
                      record preserved.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Status & disposition</CardTitle>
              <CardDescription>
                Where this lead sits in your pipeline + last call outcome.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={lead.status} />
                {lead.disposition && (
                  <Badge variant="info">{dispositionLabels[lead.disposition]}</Badge>
                )}
              </div>
              <Select value={statusValue} onValueChange={setStatusValue}>
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
              <Select value={dispositionValue} onValueChange={setDispositionValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Log call disposition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No disposition —</SelectItem>
                  {Object.entries(dispositionLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-full"
                size="sm"
                disabled={statusSaving}
                onClick={async () => {
                  setStatusSaving(true);
                  try {
                    const res = await fetch(`/api/leads/${lead.id}/status`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: statusValue, disposition: dispositionValue }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      addToast("error", data.error ?? "Failed to save status.");
                    } else {
                      addToast("success", "Status saved successfully.");
                    }
                  } catch {
                    addToast("error", "Failed to save status. Please try again.");
                  } finally {
                    setStatusSaving(false);
                  }
                }}
              >
                {statusSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Save
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Quick send</CardTitle>
                <CardDescription>Pre-built templates</CardDescription>
              </div>
              <Button size="sm" variant="ghost">
                <Pencil className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <TemplateRow label="Intro text" channel="SMS" />
              <TemplateRow label="Callback link" channel="SMS" />
              <TemplateRow label="IUL prep doc" channel="Email" />
              <TemplateRow label="Illustration walkthrough" channel="Email" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Consent record</CardTitle>
              <CardDescription>TCPA opt-in proof preserved on this lead</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-brand-red" />
                <Badge variant="success">{lead.consent.method}</Badge>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
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
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={requestReplacement}
                disabled={replacementLoading}
              >
                {replacementLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Request replacement
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
} // end LeadDetailContent

function ContactField({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: any;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="font-medium">{value}</div>
    </>
  );
  return href ? (
    <a href={href} className="block hover:text-brand-red transition-colors">
      {content}
    </a>
  ) : (
    <div>{content}</div>
  );
}

function FormResponseRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function TemplateRow({ label, channel }: { label: string; channel: string }) {
  return (
    <button className="w-full flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-2 transition-colors text-sm text-left">
      <div className="flex items-center gap-2">
        {channel === "SMS" ? (
          <MessageSquare className="h-3.5 w-3.5 text-sky-600" />
        ) : (
          <Mail className="h-3.5 w-3.5 text-violet-600" />
        )}
        <span>{label}</span>
      </div>
      <Badge variant="muted" className="text-[10px]">
        {channel}
      </Badge>
    </button>
  );
}
