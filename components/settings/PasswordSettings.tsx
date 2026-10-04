"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function PasswordSettings() {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/account/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHasPassword(d ? !!d.hasPassword : null))
      .catch(() => setHasPassword(null));
  }, []);

  async function save() {
    setMsg(null);
    if (next.length < 8) { setMsg({ ok: false, text: "New password must be at least 8 characters." }); return; }
    if (next !== confirm) { setMsg({ ok: false, text: "New passwords don't match." }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setMsg({ ok: true, text: "Password updated." }); setCurrent(""); setNext(""); setConfirm(""); }
      else setMsg({ ok: false, text: d.error ?? "Could not update password." });
    } catch {
      setMsg({ ok: false, text: "Could not update password. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change the password you use to sign in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        {hasPassword === false ? (
          <p className="text-sm text-muted-foreground">
            Your account signs in with Google, so there&apos;s no password to change here.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <PasswordInput value={current} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrent(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <PasswordInput value={next} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNext(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <PasswordInput value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="flex items-center justify-end gap-3">
              {msg && (
                <span className={cn("inline-flex items-center gap-1 text-xs", msg.ok ? "text-emerald-600" : "text-rose-600")}>
                  {msg.ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {msg.text}
                </span>
              )}
              <Button onClick={save} disabled={saving || !current || !next}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update password
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
