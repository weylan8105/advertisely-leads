"use client";

import { useState } from "react";
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
  const [password, setPassword] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!agreed) {
      setError("Please agree to the Terms and TCPA outreach policy.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, agency: agencyName }),
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

        {/* Google sign-up */}
        <div className="mt-6">
          <GoogleSignInButton label="Sign up with Google" />
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
