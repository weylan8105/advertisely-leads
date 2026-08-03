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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Member {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  role: "OWNER" | "ADMIN" | "AGENT";
  inRotation: boolean;
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
  organization: { id: string; name: string; distributionMode: "MANUAL" | "ROUND_ROBIN" };
  role: "OWNER" | "ADMIN" | "AGENT";
  canManage: boolean;
  members: Member[];
  invitations: Invitation[];
}

const roleBadge: Record<string, "success" | "muted"> = {
  OWNER: "success",
  ADMIN: "success",
  AGENT: "muted",
};

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"AGENT" | "ADMIN">("AGENT");
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setMode(mode: "MANUAL" | "ROUND_ROBIN") {
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
            {members.length} {members.length === 1 ? "member" : "members"} ·
            You&apos;re {data.role === "AGENT" ? "an agent" : `an ${data.role.toLowerCase()}`}
          </p>
        </div>
      </div>

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
            </div>
          ) : (
            <Badge variant="muted">{rr ? "Round-robin" : "Manual"}</Badge>
          )}
        </div>
        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-muted-foreground">
          {rr ? (
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

              <Badge variant={roleBadge[m.role]} className="text-[10px]">
                {m.role === "OWNER" && <ShieldCheck className="h-3 w-3 mr-1" />}
                {m.role}
              </Badge>

              <div className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
                {m.leadCount} lead{m.leadCount === 1 ? "" : "s"}
              </div>

              {/* Rotation toggle (only meaningful under round-robin) */}
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
    </div>
  );
}
