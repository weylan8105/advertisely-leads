"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Loader2, AlertCircle, UserPlus } from "lucide-react";

/**
 * Inline sign-up / sign-in shown on the payment step when the shopper isn't
 * logged in — so they can create an account without leaving checkout. On
 * success we call onAuthed() and the parent swaps in the payment form.
 */
export function CheckoutAuthPanel({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callbackUrl =
    typeof window !== "undefined" ? window.location.href : "/checkout";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Enter your email and a password.");
      return;
    }
    if (mode === "create" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "create") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Could not create your account.");
          return;
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(
          mode === "create"
            ? "Account created, but sign-in failed. Try signing in."
            : "Invalid email or password.",
        );
        return;
      }
      // Session cookie is now set — hand control back so payment can load.
      onAuthed();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus className="h-4 w-4 text-brand-red" />
        <h3 className="font-semibold">
          {mode === "create" ? "Create your account to check out" : "Sign in to check out"}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Your leads, orders, and CRM all live in your account. It takes a few seconds — no
        need to leave this page.
      </p>

      <GoogleSignInButton
        label={mode === "create" ? "Sign up with Google" : "Continue with Google"}
        callbackUrl={callbackUrl}
      />

      <div className="my-4 relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-[10px] uppercase">
          <span className="bg-slate-50 px-2 text-muted-foreground">
            or with email
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
        {mode === "create" && (
          <div className="space-y-1.5">
            <Label htmlFor="co-name">Full name</Label>
            <Input
              id="co-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Jordan Pace"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="co-email">Work email</Label>
          <Input
            id="co-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@youragency.com"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="co-password">Password</Label>
          <PasswordInput
            id="co-password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            placeholder={mode === "create" ? "At least 8 characters" : "Your password"}
            required
          />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {mode === "create" ? "Creating account…" : "Signing in…"}
            </>
          ) : mode === "create" ? (
            "Create account & continue"
          ) : (
            "Sign in & continue"
          )}
        </Button>
      </form>

      <p className="mt-4 text-xs text-center text-muted-foreground">
        {mode === "create" ? "Already have an account?" : "New to Advertisely?"}{" "}
        <button
          type="button"
          className="text-brand-red hover:underline font-medium"
          onClick={() => {
            setError(null);
            setMode(mode === "create" ? "signin" : "create");
          }}
        >
          {mode === "create" ? "Sign in" : "Create one"}
        </button>
      </p>
    </div>
  );
}
