"use client";

import { useEffect, useState, useCallback } from "react";
import {
  UsersRound,
  UserPlus,
  Loader2,
  Shuffle,
  Hand,
  Trash2,
  Mail,
  Copy,
  Check,
  ShieldCheck,
  ShoppingCart,
  PackageCheck,
  Link2,
  Clock,
  UserCheck,
  CalendarRange,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const PKG_LABELS: Record<string, string> = {
  "blue-collar-iul": "Blue-Collar IUL",
  "trucker-leads": "Trucker IUL",
};
const pkgLabel = (id: string) => PKG_LABELS[id] ?? id;

interface DownlineOrder {
  id: string;
  packageId: string;
  quantity: number;
  fulfilledCount: number;
  status: string;
  createdAt: string;
  agentName: string | null;
  buyerName: string | null;
  buyerIsSelf: boolean;
}

interface Member {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  role: "OWNER" | "ADMIN" | "AGENT";
  inRotation: boolean;
  pendingApproval: boolean;
  /** Leads/week under "Weekly amounts" (0 = none) and how many they got in the last 7 days. */
  weeklyLeadQuota: number;
  quotaThisWeek: number;
  leadCount: number;
  isSelf: boolean;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}
interface TeamData {
  organization: { id: string; name: string; distributionMode: DistributionMode };
  role: "OWNER" | "ADMIN" | "AGENT";
  canManage: boolean;
  /** The caller joined with an upline code and is waiting for approval. */
  pending: boolean;
  members: Member[];
  invitations: Invitation[];
  teams: { id: string; name: string; role: string; pending: boolean }[];
  upline: { code: string | null; team: { id: string; name: string } | null };
}

type DistributionMode = "MANUAL" | "ROUND_ROBIN" | "WEEKLY_QUOTA";

const roleBadge: Record<string, "success" | "muted"> = {
  OWNER: "success",
  ADMIN: "success",
  AGENT: "muted",
};

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [downlineOrders, setDownlineOrders] = useState<DownlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"AGENT" | "ADMIN">("AGENT");
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Weekly amount being typed per member (membershipId → text), saved on blur/Enter.
  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>({});
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
      // Orders placed for the downline (owner/admin view; [] for agents).
      try {
        const ordersRes = await fetch("/api/team/orders");
        if (ordersRes.ok) setDownlineOrders((await ordersRes.json()).orders ?? []);
      } catch {
        /* non-fatal */
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setMode(mode: DistributionMode) {
    if (!data || data.organization.distributionMode === mode) return;
    setBusy("mode");
    await fetch("/api/team/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distributionMode: mode }),
    });
    setBusy(null);
    load();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("invite");
    setInviteMsg(null);
    const res = await fetch("/api/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setInviteMsg({
        ok: true,
        text: body.emailed
          ? `Invitation emailed to ${inviteEmail}.`
          : `Invite created. Email isn't configured — copy the link below to share it.`,
      });
      setInviteEmail("");
      load();
    } else {
      setInviteMsg({ ok: false, text: body.error ?? "Could not send invite" });
    }
  }

  async function toggleRotation(m: Member) {
    setBusy(m.membershipId);
    await fetch(`/api/team/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inRotation: !m.inRotation }),
    });
    setBusy(null);
    load();
  }

  async function changeRole(m: Member, role: "ADMIN" | "AGENT") {
    setBusy(m.membershipId);
    await fetch(`/api/team/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setBusy(null);
    load();
  }

  async function removeMember(m: Member) {
    if (!confirm(`Remove ${m.name ?? m.email} from the team? Their leads revert to the owner.`)) return;
    setBusy(m.membershipId);
    await fetch(`/api/team/members/${m.membershipId}`, { method: "DELETE" });
    setBusy(null);
    load();
  }

  async function saveQuota(m: Member) {
    const raw = quotaDraft[m.membershipId];
    if (raw === undefined) return;
    const next = raw.trim() === "" ? 0 : Number(raw);
    if (next === m.weeklyLeadQuota) {
      setQuotaDraft(({ [m.membershipId]: _, ...rest }) => rest);
      return;
    }
    setBusy(m.membershipId);
    setQuotaError(null);
    const res = await fetch(`/api/team/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeklyLeadQuota: next }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setQuotaError(body.error ?? "Could not save that amount");
      return;
    }
    setQuotaDraft(({ [m.membershipId]: _, ...rest }) => rest);
    load();
  }

  async function approveMember(m: Member) {
    setBusy(m.membershipId);
    await fetch(`/api/team/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    setBusy(null);
    load();
  }

  async function switchTeam(organizationId: string) {
    setBusy("switch");
    await fetch("/api/team/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    setBusy(null);
    load();
  }

  async function joinTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy("join");
    setJoinMsg(null);
    const res = await fetch("/api/team/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: joinCode }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setJoinMsg({ ok: false, text: body.error ?? "Could not join that team" });
      return;
    }
    setJoinCode("");
    setJoinMsg({
      ok: true,
      text:
        body.status === "already-member"
          ? `You're already on ${body.teamName}.`
          : `You joined ${body.teamName}. Your upline will approve you to unlock the team's shared leads.`,
    });
    load();
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  async function revokeInvite(id: string) {
    setBusy(id);
    await fetch(`/api/team/invitations/${id}`, { method: "DELETE" });
    setBusy(null);
    load();
  }

  function copyLink(token: string, id: string) {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your team…
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-rose-600 py-20 text-center">Couldn&apos;t load team: {error}</div>;
  }

  const { organization: org, canManage, members, invitations } = data;
  const rr = org.distributionMode === "ROUND_ROBIN";
  const weekly = org.distributionMode === "WEEKLY_QUOTA";
  const weeklyTotal = members.reduce((n, m) => n + (m.role === "OWNER" ? 0 : m.weeklyLeadQuota), 0);
  const weeklySent = members.reduce((n, m) => n + (m.role === "OWNER" ? 0 : m.quotaThisWeek), 0);
  const inRotationCount = members.filter((m) => m.inRotation).length;

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <UsersRound className="h-6 w-6 text-brand-red" /> {org.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.pending ? (
              "Waiting for approval"
            ) : (
              <>
                {members.length} {members.length === 1 ? "member" : "members"} ·
                You&apos;re {data.role === "AGENT" ? "an agent" : `an ${data.role.toLowerCase()}`}
              </>
            )}
          </p>
        </div>
        {data.teams.length > 1 && (
          <div className="space-y-1">
            <Label htmlFor="active-team" className="text-xs text-muted-foreground">
              Active team
            </Label>
            <select
              id="active-team"
              value={org.id}
              onChange={(e) => switchTeam(e.target.value)}
              disabled={busy === "switch"}
              className="h-9 max-w-[220px] rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.role === "OWNER" ? " (yours)" : t.pending ? " (pending)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {data.pending && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Clock className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            You joined <span className="font-semibold">{org.name}</span> with your upline&apos;s code. Your upline
            can already send leads to your CRM. Once they approve you, you&apos;ll also see the rest of the team
            and its shared leads.
          </div>
        </div>
      )}

      {/* Distribution */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold tracking-tight">Lead distribution</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-lg">
              How purchased leads are handed out to your team.
            </p>
          </div>
          {canManage ? (
            <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50">
              <button
                onClick={() => setMode("MANUAL")}
                disabled={busy === "mode"}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  !rr ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Hand className="h-3.5 w-3.5" /> Manual
              </button>
              <button
                onClick={() => setMode("ROUND_ROBIN")}
                disabled={busy === "mode"}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  rr ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Shuffle className="h-3.5 w-3.5" /> Round-robin
              </button>
              <button
                onClick={() => setMode("WEEKLY_QUOTA")}
                disabled={busy === "mode"}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  weekly ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <CalendarRange className="h-3.5 w-3.5" /> Weekly amounts
              </button>
            </div>
          ) : (
            <Badge variant="muted">{weekly ? "Weekly amounts" : rr ? "Round-robin" : "Manual"}</Badge>
          )}
        </div>
        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-muted-foreground">
          {weekly ? (
            <>
              <span className="font-medium text-foreground">Weekly amounts is on.</span> Leads coming into the
              owner&apos;s pipeline go to each agent up to their weekly number below, only in states they&apos;re
              licensed in. Once everyone&apos;s full for the week, the rest stay with the owner.
              {weeklyTotal > 0 && (
                <span className="block mt-1.5 text-foreground">
                  {weeklySent} of {weeklyTotal} sent to agents in the last 7 days.
                </span>
              )}
            </>
          ) : rr ? (
            <>
              <span className="font-medium text-foreground">Round-robin is on.</span> New purchased leads are
              spread evenly across the {inRotationCount} member{inRotationCount === 1 ? "" : "s"} in rotation
              below.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Manual is on.</span> All purchased leads go to the
              team owner, who can reassign them by hand.
            </>
          )}
        </div>
      </Card>

      {/* Members */}
      <Card className="p-6">
        <h2 className="font-semibold tracking-tight mb-4">Members</h2>
        {weekly && canManage && (
          <p className="-mt-2 mb-4 text-sm text-muted-foreground">
            Type how many leads each agent gets per week (0 for none), then press Enter.
            {quotaError && <span className="block mt-1 text-rose-600">{quotaError}</span>}
          </p>
        )}
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.membershipId}
              className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 flex-wrap"
            >
              <div className="h-9 w-9 shrink-0 grid place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                {(m.name ?? m.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {m.name ?? m.email.split("@")[0]}
                  {m.isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
              </div>

              {m.pendingApproval && (
                <Badge variant="muted" className="text-[10px] border-amber-200 bg-amber-50 text-amber-800">
                  <Clock className="h-3 w-3 mr-1" />
                  Needs approval
                </Badge>
              )}
              <Badge variant={roleBadge[m.role]} className="text-[10px]">
                {m.role === "OWNER" && <ShieldCheck className="h-3 w-3 mr-1" />}
                {m.role}
              </Badge>

              <div className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
                {m.leadCount} lead{m.leadCount === 1 ? "" : "s"}
              </div>

              {/* Weekly amount (under "Weekly amounts"): leads/week + progress */}
              {weekly && m.role !== "OWNER" && (
                <div className="flex items-center gap-2">
                  {canManage ? (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={1000}
                        aria-label={`Weekly leads for ${m.name ?? m.email}`}
                        value={quotaDraft[m.membershipId] ?? String(m.weeklyLeadQuota || "")}
                        placeholder="0"
                        onChange={(e) => setQuotaDraft((d) => ({ ...d, [m.membershipId]: e.target.value }))}
                        onBlur={() => saveQuota(m)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        disabled={busy === m.membershipId}
                        className="h-8 w-16 px-2 text-sm tabular-nums"
                      />
                      /wk
                    </label>
                  ) : null}
                  <div className="w-24">
                    <div className="text-[11px] tabular-nums text-muted-foreground mb-1">
                      {m.weeklyLeadQuota > 0
                        ? `${m.quotaThisWeek} of ${m.weeklyLeadQuota} this week`
                        : "No weekly leads"}
                    </div>
                    {m.weeklyLeadQuota > 0 && (
                      <Progress
                        value={Math.min(100, Math.round((m.quotaThisWeek / m.weeklyLeadQuota) * 100))}
                        className="h-1.5"
                      />
                    )}
                  </div>
                </div>
              )}
              {weekly && m.role === "OWNER" && (
                <div className="text-xs text-muted-foreground whitespace-nowrap">Keeps the rest</div>
              )}

              {/* Rotation toggle (only meaningful under round-robin) */}
              {!weekly && (
                <button
                  onClick={() => canManage && toggleRotation(m)}
                  disabled={!canManage || busy === m.membershipId}
                  title={m.inRotation ? "In rotation" : "Excluded from rotation"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs border transition-colors",
                    m.inRotation
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-muted-foreground",
                    !canManage && "opacity-70 cursor-default",
                  )}
                >
                  {busy === m.membershipId ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : m.inRotation ? (
                    <Check className="h-3 w-3" />
                  ) : null}
                  {m.inRotation ? "In rotation" : "Paused"}
                </button>
              )}

              {canManage && !m.isSelf && (
                <a href={`/checkout?for=${m.userId}`} title={`Order leads for ${m.name ?? m.email}`}>
                  <Button size="sm" variant="outline">
                    <ShoppingCart className="h-3.5 w-3.5" /> Order leads
                  </Button>
                </a>
              )}

              {canManage && m.pendingApproval && (
                <Button size="sm" onClick={() => approveMember(m)} disabled={busy === m.membershipId}>
                  <UserCheck className="h-3.5 w-3.5" /> Approve
                </Button>
              )}

              {canManage && m.role !== "OWNER" && (
                <div className="flex items-center gap-1">
                  {m.role === "AGENT" ? (
                    <Button size="sm" variant="ghost" onClick={() => changeRole(m, "ADMIN")}>
                      Make admin
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => changeRole(m, "AGENT")}>
                      Make agent
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => removeMember(m)}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Orders placed for the downline (owners/admins only) */}
      {canManage && downlineOrders.length > 0 && (
        <Card className="p-6">
          <h2 className="font-semibold tracking-tight flex items-center gap-2 mb-1">
            <PackageCheck className="h-4 w-4" /> Orders placed for your downline
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Leads you bought for your agents deliver straight to their pipelines. Track delivery here.
          </p>
          <div className="space-y-2">
            {downlineOrders.map((o) => {
              const pct = o.quantity > 0 ? Math.round((o.fulfilledCount / o.quantity) * 100) : 0;
              return (
                <div
                  key={o.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 flex-wrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {o.agentName ?? "Agent"}
                      <span className="text-muted-foreground font-normal"> · {pkgLabel(o.packageId)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {o.quantity} leads
                      {!o.buyerIsSelf && o.buyerName ? ` · placed by ${o.buyerName}` : ""}
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="tabular-nums font-medium">
                        {o.fulfilledCount}/{o.quantity}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          pct >= 100 ? "text-emerald-600 font-medium" : "text-muted-foreground",
                        )}
                      >
                        {pct >= 100 ? "Complete" : `${pct}%`}
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Invite + pending (owners/admins only) */}
      {canManage && (
        <Card className="p-6">
          <h2 className="font-semibold tracking-tight flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Invite a teammate
          </h2>
          <form onSubmit={invite} className="mt-4 flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="agent@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "AGENT" | "ADMIN")}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <Button type="submit" disabled={busy === "invite"}>
              {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send invite
            </Button>
          </form>
          {inviteMsg && (
            <p className={cn("mt-3 text-sm", inviteMsg.ok ? "text-emerald-600" : "text-rose-600")}>
              {inviteMsg.text}
            </p>
          )}

          {invitations.length > 0 && (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Pending invitations
              </div>
              <div className="space-y-2">
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-2.5 flex-wrap"
                  >
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1 min-w-0 truncate">{inv.email}</span>
                    <Badge variant="muted" className="text-[10px]">
                      {inv.role}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => copyLink((inv as any).token ?? "", inv.id)}>
                      {copied === inv.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => revokeInvite(inv.id)}>
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Upline code: share it to recruit (everyone has one) */}
      {data.upline.code && (
        <Card className="p-6">
          <h2 className="font-semibold tracking-tight flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Grow your team with your code
          </h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-xl">
            Agents who enter your code when they create their Advertisely account join{" "}
            <span className="font-medium text-foreground">{data.upline.team?.name ?? "your team"}</span> right
            away. You approve each one here before they see the team&apos;s shared leads. It&apos;s the same code
            that gives 10% off at checkout.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold tracking-wider">
              {data.upline.code}
            </div>
            <Button size="sm" variant="outline" onClick={() => copyText(data.upline.code!, "code")}>
              {copied === "code" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              Copy code
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                copyText(`${window.location.origin}/signup?upline=${encodeURIComponent(data.upline.code!)}`, "link")
              }
            >
              {copied === "link" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}
              Copy signup link
            </Button>
            {data.upline.team &&
              data.upline.team.id !== org.id &&
              data.teams.some((t) => t.id === data.upline.team!.id) && (
                <Button size="sm" variant="ghost" onClick={() => switchTeam(data.upline.team!.id)}>
                  View {data.upline.team.name}
                </Button>
              )}
          </div>
        </Card>
      )}

      {/* Existing accounts: join an upline's team with their code */}
      <Card className="p-6">
        <h2 className="font-semibold tracking-tight flex items-center gap-2">
          <UsersRound className="h-4 w-4" /> Have an upline?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Enter their code to join their team.</p>
        <form onSubmit={joinTeam} className="mt-4 flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px] max-w-xs space-y-1.5">
            <Label htmlFor="join-code">Upline code</Label>
            <Input
              id="join-code"
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 20))}
              placeholder="e.g. RYAN7K"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" variant="outline" disabled={busy === "join" || !joinCode.trim()}>
            {busy === "join" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Join team
          </Button>
        </form>
        {joinMsg && (
          <p className={cn("mt-3 text-sm", joinMsg.ok ? "text-emerald-600" : "text-rose-600")}>{joinMsg.text}</p>
        )}
      </Card>
    </div>
  );
}
