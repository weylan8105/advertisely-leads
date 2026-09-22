"use client";

import { useEffect, useState } from "react";
import { Loader2, Phone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SNOOZE_KEY = "adv_phone_prompt_snooze";
const SNOOZE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Shown to any signed-in client who has no phone number on file (accounts that
 * predate phone collection at signup). Saves via /api/account/phone. Dismissing
 * with "Remind me later" snoozes the prompt for 24h; providing a number retires
 * it for good (the server now has a phone, so it won't reappear).
 */
export function PhonePrompt() {
  const [show, setShow] = useState(false);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Respect an active snooze before hitting the network.
    try {
      const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
      if (until && Date.now() < until) return;
    } catch {
      /* ignore storage errors */
    }
    let alive = true;
    fetch("/api/account/phone")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && !d.phone) setShow(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid phone number.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "Couldn't save your number. Please try again.");
        return;
      }
      try {
        localStorage.removeItem(SNOOZE_KEY);
      } catch {
        /* ignore */
      }
      setShow(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={snooze} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <button
          onClick={snooze}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
          aria-label="Remind me later"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-brand-red/10 text-brand-red">
          <Phone className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">Add your phone number</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We use it to reach you quickly about your leads, orders, and account — and to verify your identity if you
          ever need support. It&apos;s never shared with other agents.
        </p>

        <form onSubmit={save} className="mt-5 space-y-3">
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="prompt-phone">Phone number</Label>
            <Input
              id="prompt-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save number
            </Button>
            <Button type="button" variant="ghost" onClick={snooze} disabled={saving}>
              Remind me later
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
