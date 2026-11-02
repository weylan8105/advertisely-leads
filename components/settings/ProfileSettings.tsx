"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { AVAILABLE_STATES, US_STATES, stateName } from "@/data/states";
import { cn } from "@/lib/utils";

export function ProfileSettings() {
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agency, setAgency] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [license, setLicense] = useState({
    licenseName: "",
    licenseResidentState: "",
    licenseNpn: "",
    licenseCaNumber: "",
    licenseTxNumber: "",
  });
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
          setLicense({
            licenseName: d.licenseName ?? "",
            licenseResidentState: d.licenseResidentState ?? "",
            licenseNpn: d.licenseNpn ?? "",
            licenseCaNumber: d.licenseCaNumber ?? "",
            licenseTxNumber: d.licenseTxNumber ?? "",
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setLic = (k: keyof typeof license) => (e: { target: { value: string } }) =>
    setLicense((prev) => ({ ...prev, [k]: e.target.value }));
  const licenseComplete = !!(license.licenseName.trim() && license.licenseResidentState && license.licenseNpn.trim());

  const toggle = (code: string) =>
    setStates((prev) => (prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, agency, licensedStates: states, ...license }),
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
                  title={stateName(s)}
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

        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Producer license (public)</Label>
              <span className={cn("text-[11px]", licenseComplete ? "text-emerald-600" : "text-amber-600")}>
                {licenseComplete ? "Listed on Licensed Partners" : "Incomplete · not listed"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Some states require consumers to be told which licensed agent may contact them. While you receive leads from
              our consumer funnels, your licensed name, resident state, NPN, and CA/TX license numbers are shown on the
              public{" "}
              <a href="/licensed-partners" target="_blank" rel="noopener" className="underline">
                Licensed Partners
              </a>{" "}
              page. Enter them exactly as they appear on your license.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Licensed name</Label>
              <Input value={license.licenseName} onChange={setLic("licenseName")} placeholder="Name on your license (you or your agency)" disabled={!loaded} />
            </div>
            <div className="space-y-1.5">
              <Label>Resident state</Label>
              <select
                value={license.licenseResidentState}
                onChange={setLic("licenseResidentState")}
                disabled={!loaded}
                className="flex h-10 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select…</option>
                {[...US_STATES, "DC"].map((s) => (
                  <option key={s} value={s}>
                    {stateName(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>National Producer Number (NPN)</Label>
              <Input value={license.licenseNpn} onChange={setLic("licenseNpn")} inputMode="numeric" placeholder="e.g. 12345678" disabled={!loaded} />
            </div>
            <div className="space-y-1.5">
              <Label>California license #{states.includes("CA") ? "" : " (if licensed in CA)"}</Label>
              <Input value={license.licenseCaNumber} onChange={setLic("licenseCaNumber")} placeholder="e.g. 0L12345" disabled={!loaded} />
            </div>
            <div className="space-y-1.5">
              <Label>Texas license #{states.includes("TX") ? "" : " (if licensed in TX)"}</Label>
              <Input value={license.licenseTxNumber} onChange={setLic("licenseTxNumber")} placeholder="Texas license number" disabled={!loaded} />
            </div>
          </div>
          {((states.includes("CA") && !license.licenseCaNumber.trim()) || (states.includes("TX") && !license.licenseTxNumber.trim())) && (
            <p className="text-[11px] text-amber-600">
              You&apos;re licensed in {[states.includes("CA") && !license.licenseCaNumber.trim() ? "CA" : "", states.includes("TX") && !license.licenseTxNumber.trim() ? "TX" : ""].filter(Boolean).join(" and ")}: add that license number too.
            </p>
          )}
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
