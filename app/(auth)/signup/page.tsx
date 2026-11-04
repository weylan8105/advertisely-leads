"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { AVAILABLE_STATES, stateName } from "@/data/states";
import { cn } from "@/lib/utils";
import { UPLINE_COOKIE, ADVERTISER_COOKIE } from "@/lib/uplineCookie";

type UplineCheck =
  | { state: "idle" | "checking" }
  | { state: "valid"; code: string; teamName: string; uplineFirstName: string | null }
  | { state: "invalid"; error: string };

const perks = [
  "Blue-Collar IUL leads delivered within 24 hours of your order",
  "Built-in lightweight CRM with notes, statuses, and agent assignment",
  "CSV + Google Sheets exports in one click",
  "Native GoHighLevel, Salesforce, HubSpot, and webhook integrations",
  "Replacement requests on bad numbers within 72 hours",
];

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const toggleState = (code: string) =>
    setLicensedStates((prev) => (prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteOrg, setInviteOrg] = useState<string | null>(null);
  // "Do you have an upline?" — their Advertisely code puts this agent on their team.
  const [uplineCode, setUplineCode] = useState("");
  const [upline, setUpline] = useState<UplineCheck>({ state: "idle" });

  // Prefill from a shared signup link (?upline=CODE).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("upline");
    if (c) setUplineCode(c.toUpperCase().slice(0, 20));
  }, []);

  // Check the code as they type, so they see whose team they're joining.
  useEffect(() => {
    const code = uplineCode.trim();
    if (!code) {
      setUpline({ state: "idle" });
      return;
    }
    setUpline({ state: "checking" });
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/team/code?code=${encodeURIComponent(code)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((b) =>
          setUpline(
            b?.valid
              ? { state: "valid", code: b.code, teamName: b.teamName, uplineFirstName: b.uplineFirstName ?? null }
              : { state: "invalid", error: b?.error ?? "We couldn't find that code." },
          ),
        )
        .catch((e) => {
          if (e?.name !== "AbortError") setUpline({ state: "idle" });
        });
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [uplineCode]);

  // Google signup leaves the page, so carry the code in a short-lived cookie
  // that the server reads when the account is created (lib/auth.ts).
  function rememberUplineForGoogle() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      upline.state === "valid" && !inviteToken
        ? `${UPLINE_COOKIE}=${encodeURIComponent(upline.code)}; Max-Age=1800; Path=/; SameSite=Lax${secure}`
        : `${UPLINE_COOKIE}=; Max-Age=0; Path=/`;
    document.cookie = advertiserToken
      ? `${ADVERTISER_COOKIE}=${encodeURIComponent(advertiserToken)}; Max-Age=1800; Path=/; SameSite=Lax${secure}`
      : `${ADVERTISER_COOKIE}=; Max-Age=0; Path=/`;
  }

  // Advertiser invite link (?advertiser=<token>): the new account is created as
  // an advertiser (checked server-side again on create).
  const [advertiserToken, setAdvertiserToken] = useState("");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("advertiser");
    if (!t) return;
    fetch(`/api/advertiser-invite?token=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((b) => { if (b?.valid) setAdvertiserToken(t); })
      .catch(() => {});
  }, []);

  // If the signup link carries a downline invite (?invite=<token>), fetch its
  // details, lock the email to the invited address, and auto-join on submit.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("invite");
    if (!t) return;
    fetch(`/api/invite/${t}`)
      .then((r) => r.json())
      .then((b) => {
        if (b && b.valid) {
          setInviteToken(t);
          setInviteOrg(b.orgName ?? null);
          if (b.email) setEmail(b.email);
        }
      })
      .catch(() => {});
  }, []);

  function handleGoogleSignup() {
    // Persist agency name so it can be attached to the profile after OAuth.
    if (agencyName) {
      sessionStorage.setItem("signup_agency", agencyName);
    }
    signIn("google", { callbackUrl: "/dashboard" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter your email and a password.");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid phone number.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!agreed) {
      setError("Please agree to the Terms and TCPA outreach policy.");
      return;
    }
    if (!inviteToken && upline.state === "invalid") {
      setError("That upline code wasn't found. Fix it or leave it blank.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          password,
          agency: agencyName,
          licensedStates,
          inviteToken,
          uplineCode: inviteToken ? "" : uplineCode.trim(),
          advertiserToken,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not create your account. Please try again.");
        return;
      }

      // Account created — sign them straight in with the same credentials.
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.error) {
        setError("Account created, but sign-in failed. Please sign in manually.");
        router.push("/login");
      } else {
        router.push(result?.url ?? "/dashboard");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
      <div className="hidden lg:block">
        <h1 className="text-4xl font-semibold tracking-tight leading-tight">
          Create your Advertisely <br />
          <span className="text-gradient">agent workspace.</span>
        </h1>
        <p className="mt-4 text-muted-foreground max-w-md">
          Two minutes to set up, zero contracts, and full marketplace access on day one.
        </p>
        <ul className="mt-8 space-y-3 text-sm">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-brand-red shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <Card className="p-8 max-w-md mx-auto w-full glass-strong">
        <div className="text-xs uppercase tracking-[0.18em] text-brand-red mb-2">
          Create account
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Spin up your workspace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          You'll be browsing the marketplace in under 60 seconds.
        </p>

        {advertiserToken && (
          <div className="mt-4 rounded-md border border-sky-300 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
            You&apos;re creating an <span className="font-semibold">Advertiser account</span>. Leads from your own ad
            campaign will go straight to your CRM.
          </div>
        )}

        {inviteOrg && (
          <div className="mt-4 rounded-md border border-brand-red/30 bg-brand-red/[0.06] px-3 py-2.5 text-sm">
            You've been invited to join <span className="font-semibold">{inviteOrg}</span>'s downline. Create your
            account below and you'll be added to their team automatically.
          </div>
        )}

        {/* Google sign-up */}
        <div className="mt-6">
          <GoogleSignInButton label="Sign up with Google" onBeforeSignIn={rememberUplineForGoogle} />
        </div>

        <div className="mt-5 relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-300" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase">
            <span className="bg-card px-2 text-muted-foreground">or sign up with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              placeholder="Jordan Pace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@youragency.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              readOnly={!!inviteToken}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agency">
              Agency / IMO <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="agency"
              placeholder="Your agency or independent"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
            />
          </div>

          {!inviteToken && (
            <div className="space-y-1.5">
              <Label htmlFor="upline">
                Do you have an upline? <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="upline"
                placeholder="Enter their code here"
                value={uplineCode}
                onChange={(e) => setUplineCode(e.target.value.toUpperCase().slice(0, 20))}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby="upline-help"
              />
              <p
                id="upline-help"
                className={cn(
                  "text-[11px]",
                  upline.state === "valid"
                    ? "text-emerald-700"
                    : upline.state === "invalid"
                      ? "text-rose-600"
                      : "text-muted-foreground",
                )}
              >
                {upline.state === "valid"
                  ? `You'll join ${upline.teamName}${
                      upline.uplineFirstName && !upline.teamName.includes(upline.uplineFirstName)
                        ? ` as ${upline.uplineFirstName}'s downline`
                        : ""
                    }.`
                  : upline.state === "invalid"
                    ? upline.error
                    : upline.state === "checking"
                      ? "Checking code…"
                      : "Their Advertisely code puts you on their team as soon as your account is created."}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>
                States you&apos;re licensed in{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {licensedStates.length > 0 ? `${licensedStates.length} selected` : "pre-fills your orders"}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1 rounded-md border border-slate-300 p-2 bg-slate-50 max-h-[132px] overflow-y-auto scrollbar-thin">
              {AVAILABLE_STATES.map((s) => {
                const on = licensedStates.includes(s);
                return (
                  <button
                    key={s}
                    title={stateName(s)}
                    type="button"
                    onClick={() => toggleState(s)}
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
            <p className="text-[10px] text-muted-foreground">
              We&apos;ll automatically pre-select these states on every order. You can change this
              anytime in Settings.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(!!v)}
              className="mt-0.5"
            />
            <span>
              I agree to the{" "}
              <Link href="#" className="text-brand-red hover:underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="#" className="text-brand-red hover:underline">
                TCPA outreach policy
              </Link>
              . I will only contact leads after verifying captured consent.
            </span>
          </label>

          <Button className="w-full" size="lg" type="submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        <p className="mt-6 text-xs text-center text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-red hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
