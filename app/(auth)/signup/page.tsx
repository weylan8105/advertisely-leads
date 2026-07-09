"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { CheckCircle2, Info } from "lucide-react";

const perks = [
  "Real-time delivery on Fresh & Retirement-Focused packages",
  "Built-in lightweight CRM with notes, statuses, and agent assignment",
  "CSV + Google Sheets exports in one click",
  "Native GoHighLevel, Salesforce, HubSpot, and webhook integrations",
  "Replacement requests on bad numbers within 72 hours",
];

export default function SignupPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [agencyName, setAgencyName] = useState("");

  function handleGoogleSignup() {
    // Store agency name in sessionStorage so we can save it post-auth if needed
    if (agencyName) {
      sessionStorage.setItem("signup_agency", agencyName);
    }
    signIn("google", { callbackUrl: "/dashboard" });
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

        {/* Optional agency name before Google sign-up */}
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="agency">Agency / IMO <span className="text-muted-foreground font-normal">(optional)</span></Label>
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

          <Button
            className="w-full"
            size="lg"
            onClick={handleGoogleSignup}
            disabled={!agreed}
            type="button"
          >
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Create account with Google
          </Button>

          <div className="flex items-start gap-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2.5 text-[11px] text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-brand-red" />
            We use Google for secure sign-in. No password to remember — just your Google account.
          </div>
        </div>

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
