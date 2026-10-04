"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { AVAILABLE_STATES } from "@/data/states";
import { cn } from "@/lib/utils";

export function ProfileSettings() {
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agency, setAgency] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/account/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setName(d.name ?? "");
          setEmail(d.email ?? "");
          setPhone(d.phone ?? "");
          setAgency(d.agency ?? "");
          setStates(Array.isArray(d.licensedStates) ? d.licensedStates : []);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const toggle = (code: string) =>
    setStates((prev) => (prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, agency, licensedStates: states }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setMsg({ ok: true, text: "Saved." });
      else setMsg({ ok: false, text: d.error ?? "Could not save." });
    } catch {
      setMsg({ ok: false, text: "Could not save. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile & licensing</CardTitle>
        <CardDescription>
          Used for lead assignment, CRM attribution, and outreach signature. Your licensed states
          pre-fill the state selection on every order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!loaded} />
          </div>
          <div className="space-y-1.5">
            <Label>Work email</Label>
            <Input value={email} readOnly className="bg-slate-50 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" disabled={!loaded} />
          </div>
          <div className="space-y-1.5">
            <Label>Agency / IMO</Label>
            <Input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="Your agency or independent" disabled={!loaded} />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>States you&apos;re licensed in</Label>
            <span className="text-[11px] text-muted-foreground">
              {states.length > 0 ? `${states.length} selected · pre-fills your orders` : "pre-fills your orders"}
            </span>
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1 rounded-md border border-slate-300 p-2 bg-slate-50">
            {AVAILABLE_STATES.map((s) => {
              const on = states.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  disabled={!loaded}
                  aria-pressed={on}
                  className={cn(
                    "text-[11px] py-1 rounded transition-colors",
                    on ? "bg-brand-red text-white font-semibold" : "text-muted-foreground hover:bg-slate-100",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">Only states we currently sell leads in are shown. More unlock as inventory grows.</p>
        </div>

        <div className="flex items-center justify-end gap-3">
          {msg && (
            <span className={cn("inline-flex items-center gap-1 text-xs", msg.ok ? "text-emerald-600" : "text-rose-600")}>
              {msg.ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {msg.text}
            </span>
          )}
          <Button onClick={save} disabled={saving || !loaded}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
