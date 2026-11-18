"use client";

import { useEffect, useState, useCallback } from "react";
import { TeamDialsCard } from "@/components/dashboard/TeamDialsCard";
import {
  UsersRound,
  UserPlus,
  Loader2,
  Trash2,
  Mail,
  Copy,
  Check,
  ShieldCheck,
  ShoppingCart,
  PackageCheck,
  Link2,
  Gem,
  Megaphone,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { RingyKeysModal } from "@/components/RingyKeysModal";

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
  goldmineAccess: boolean;
  /** Runs their own campaign; managers see their weekly ad spend. */
  isAdvertiser: boolean;
  /** Advertiser team: may add spend to the owner's campaign; their credit left. */
  adSpendAccess: boolean;
  adSpendCreditCents: number;
  leadCount: number;
  /** Their Ringy CRM is connected (shown to managers who can link Ringy). */
  ringyConnected: boolean;
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
  organization: { id: string; name: string; leadDestination: LeadDestination };
  role: "OWNER" | "ADMIN" | "AGENT";
  canManage: boolean;
  /** The team's manager switched off the caller's Goldmine access. */
  goldmineOff: boolean;
  /** The team owner runs their own campaign (advertiser). */
  advertiserTeam: boolean;
  /** The caller manages this team and has Ringy, so they can link it for downlines. */
  canLinkRingy: boolean;
  members: Member[];
  invitations: Invitation[];
  teams: { id: string; name: string; role: string }[];
  upline: { code: string | null; team: { id: string; name: string } | null };
}

type LeadDestination = "PERSONAL" | "SPLIT" | "GOLDMINE";
const DESTINATION_LABEL: Record<LeadDestination, string> = {
  PERSONAL: "your pipeline only",
  SPLIT: "round robin between your pipeline and the Goldmine",
  GOLDMINE: "the Goldmine only",
};

/** A member advertiser's ad spend paid in (/api/team/member-ad-spend). */
interface MemberAdSpend {
  userId: string;
  last7Cents: number;
  avgWeekCents: number;
}
const usd0 = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
  const [ringyFor, setRingyFor] = useState<Member | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"AGENT" | "ADMIN">("AGENT");
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [memberAdSpend, setMemberAdSpend] = useState<Record<string, MemberAdSpend>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
      // Ad spend of members who run their own campaign (managers only; slower, so not awaited).
      fetch("/api/team/member-ad-spend")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.members) setMemberAdSpend(Object.fromEntries(d.members.map((m: MemberAdSpend) => [m.userId, m])));
        })
        .catch(() => {});
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

  async function toggleGoldmine(m: Member) {
    setBusy(m.membershipId);
    await fetch(`/api/team/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goldmineAccess: !m.goldmineAccess }),
    });
    setBusy(null);
    load();
  }

  async function toggleAdSpend(m: Member) {
    setBusy(m.membershipId);
    await fetch(`/api/team/members/${m.membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adSpendAccess: !m.adSpendAccess }),
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
    // One upline at a time: joining a new team moves the agent off their others.
    const current = data?.teams.filter((t) => t.role === "AGENT").map((t) => t.name) ?? [];
    if (
      current.length > 0 &&
      !confirm(`You're an agent on ${current.join(" and ")}. Joining a new upline's team moves you off it. Your leads stay with you. Continue?`)
    ) {
      return;
    }
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
    const left: string[] = body.left ?? [];
    const moved = left.length > 0 ? ` You left ${left.join(" and ")}.` : "";
    setJoinMsg({
      ok: true,
      text:
        body.status === "already-member"
          ? `You're on ${body.teamName}.${moved}`
          : `You joined ${body.teamName}.${moved} You can work the team's Goldmine now.`,
    });
    load();
  }

  async function leaveTeam() {
    if (!data) return;
    if (!confirm(`Leave ${data.organization.name}? Your leads stay in your CRM.`)) return;
    setBusy("leave");
    const res = await fetch("/api/team/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: data.organization.id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      alert(body.error ?? "Could not leave that team");
      return;
    }
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

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <UsersRound className="h-6 w-6 text-brand-red" /> {org.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {members.length} {members.length === 1 ? "member" : "members"} ·
            You&apos;re {data.role === "AGENT" ? "an agent" : `an ${data.role.toLowerCase()}`}
          </p>
        </div>
        <div className="flex items-end gap-2">
        {data.role !== "OWNER" && (
          <Button size="sm" variant="ghost" onClick={leaveTeam} disabled={busy === "leave"}>
            {busy === "leave" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Leave team
          </Button>
        )}
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
                  {t.role === "OWNER" ? " (yours)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        </div>
      </div>

      {/* Uplines: each member's dials today and the 9 pm report. */}
      <TeamDialsCard />

      {data.goldmineOff && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Gem className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            Your upline switched off your access to <span className="font-semibold">{org.name}</span>&apos;s
            Goldmine. Leads they send you still go to your CRM.
          </div>
        </div>
      )}

      {/* Members */}
      <Card className="p-6">
        <h2 className="font-semibold tracking-tight mb-1">Members</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {data.role === "OWNER" ? (
            <>
              Your new leads go to {DESTINATION_LABEL[org.leadDestination]}.{" "}
              <a href="/dashboard#lead-destination" className="font-medium text-brand-red hover:underline">
                Change on your dashboard
              </a>
              . Members with Goldmine on can work the team&apos;s Goldmine.
            </>
          ) : (
            <>Members with Goldmine on can work the team&apos;s Goldmine.</>
          )}
        </p>
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

              {/* Goldmine access: on by default; managers switch any member's on or off. */}
              {m.role !== "OWNER" && (
                <button
                  onClick={() => canManage && toggleGoldmine(m)}
                  disabled={!canManage || busy === m.membershipId}
                  title={m.goldmineAccess ? "Can work the team's Goldmine. Click to switch off." : "Goldmine access is off. Click to switch on."}
                  aria-pressed={m.goldmineAccess}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs border transition-colors",
                    m.goldmineAccess
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-slate-50 text-muted-foreground",
                    !canManage && "opacity-70 cursor-default",
                  )}
                >
                  {busy === m.membershipId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gem className="h-3 w-3" />}
                  {m.goldmineAccess ? "Goldmine on" : "Goldmine off"}
                </button>
              )}

              {/* A member running their own campaign: what they put into ad spend (managers only). */}
              {canManage && m.isAdvertiser && !m.isSelf && (
                <div
                  className="flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800"
                  title="Ad spend they paid in for their own campaign, before the 3% card fee"
                >
                  <Megaphone className="h-3 w-3" />
                  {memberAdSpend[m.userId] ? (
                    <span className="tabular-nums">
                      {usd0(memberAdSpend[m.userId].last7Cents)} ad spend last 7 days ·{" "}
                      {usd0(memberAdSpend[m.userId].avgWeekCents)}/wk avg
                    </span>
                  ) : (
                    <span>Advertiser</span>
                  )}
                </div>
              )}

              <Badge variant={roleBadge[m.role]} className="text-[10px]">
                {m.role === "OWNER" && <ShieldCheck className="h-3 w-3 mr-1" />}
                {m.role}
              </Badge>

              <div className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
                {m.leadCount} lead{m.leadCount === 1 ? "" : "s"}
              </div>

              {canManage && !m.isSelf && (
                <a href={`/checkout?for=${m.userId}`} title={`Order leads for ${m.name ?? m.email}`}>
                  <Button size="sm" variant="outline">
                    <ShoppingCart className="h-3.5 w-3.5" /> Order leads
                  </Button>
                </a>
              )}

              {/* Advertiser team: may this member add spend to the owner's campaign for its leads? Off by default. */}
              {data.advertiserTeam && m.role !== "OWNER" && (canManage || m.isSelf) && (
                <button
                  onClick={() => canManage && toggleAdSpend(m)}
                  disabled={!canManage || busy === m.membershipId}
                  title={
                    m.adSpendAccess
                      ? "Can add spend to the campaign and get campaign leads for it"
                      : "Can't add spend to the campaign"
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs border transition-colors",
                    m.adSpendAccess
                      ? "border-sky-200 bg-sky-50 text-sky-800"
                      : "border-slate-200 bg-slate-50 text-muted-foreground",
                    !canManage && "opacity-70 cursor-default",
                  )}
                >
                  <Megaphone className="h-3 w-3" />
                  {m.adSpendAccess ? "Ad spend on" : "Ad spend off"}
                  {m.adSpendCreditCents > 0 && (
                    <span className="tabular-nums opacity-80">
                      · {(m.adSpendCreditCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} credit
                    </span>
                  )}
                </button>
              )}

              {/* Managers who have Ringy can connect it for their downlines. */}
              {data.canLinkRingy && m.role !== "OWNER" && !m.isSelf && (
                <button
                  onClick={() => setRingyFor(m)}
                  title={
                    m.ringyConnected
                      ? "Ringy connected: their leads also go to their Ringy. Click to manage."
                      : "Send this member's leads into their Ringy CRM"
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs border transition-colors",
                    m.ringyConnected
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Link2 className="h-3 w-3" />
                  {m.ringyConnected ? "Ringy ✓" : "Link Ringy"}
                </button>
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
            away and can work your Goldmine (switch anyone&apos;s off below). It&apos;s the same code that gives 10%
            off at checkout.
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
        <p className="mt-1 text-sm text-muted-foreground">
          Enter their code to join their team. Already on another upline&apos;s team? Their code moves you over.
        </p>
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

      {ringyFor && (
        <RingyKeysModal
          userId={ringyFor.userId}
          name={ringyFor.name ?? ringyFor.email}
          connected={ringyFor.ringyConnected}
          endpoint="/api/team/ringy"
          description="Every lead from your campaign that goes to this member will also be sent into their Ringy account."
          onClose={(changed) => { setRingyFor(null); if (changed) load(); }}
        />
      )}
    </div>
  );
}
