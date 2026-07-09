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
import { ShieldCheck, Zap, Database, Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.error) {
        setError("Invalid email or password. Please try again.");
      } else if (result?.url) {
        router.push(result.url);
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
      <div className="hidden lg:block">
        <h1 className="text-4xl font-semibold tracking-tight leading-tight">
          Welcome back. <br />
          <span className="text-gradient">Your IUL pipeline is waiting.</span>
        </h1>
        <p className="mt-4 text-muted-foreground max-w-md">
          Sign in to manage purchased leads, place new orders, and route fresh leads to your CRM.
        </p>
        <ul className="mt-8 space-y-3 text-sm">
          <li className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-brand-red" /> Real-time lead delivery
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-red" /> TCPA-compliant by default
          </li>
          <li className="flex items-center gap-2">
            <Database className="h-4 w-4 text-brand-red" /> CRM, CSV, Sheets, Webhooks
          </li>
        </ul>
      </div>

      <Card className="p-8 max-w-md mx-auto w-full glass-strong">
        <div className="text-xs uppercase tracking-[0.18em] text-brand-red mb-2">Sign in</div>
        <h2 className="text-2xl font-semibold tracking-tight">Access your dashboard</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Use the email associated with your agency seat.
        </p>

        {/* Google sign-in — primary method */}
        <div className="mt-6">
          <GoogleSignInButton />
        </div>

        <div className="mt-5 relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-300" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase">
            <span className="bg-card px-2 text-muted-foreground">or sign in with email</span>
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="#" className="text-xs text-brand-red hover:underline">
                Forgot?
              </Link>
            </div>
            <PasswordInput
              id="password"
              placeholder="••••••••"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox defaultChecked /> Keep me signed in for 30 days
          </label>
          <Button className="w-full" size="lg" type="submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <p className="mt-6 text-xs text-center text-muted-foreground">
          New to Advertisely?{" "}
          <Link href="/signup" className="text-brand-red hover:underline">
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  );
}
