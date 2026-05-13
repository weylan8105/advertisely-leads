import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, Zap, Database } from "lucide-react";

export default function LoginPage() {
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
            <Zap className="h-4 w-4 text-brand-teal" /> Real-time lead delivery
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-teal" /> TCPA-compliant by default
          </li>
          <li className="flex items-center gap-2">
            <Database className="h-4 w-4 text-brand-teal" /> CRM, CSV, Sheets, Webhooks
          </li>
        </ul>
      </div>

      <Card className="p-8 max-w-md mx-auto w-full glass-strong">
        <div className="text-xs uppercase tracking-[0.18em] text-brand-teal mb-2">Sign in</div>
        <h2 className="text-2xl font-semibold tracking-tight">Access your dashboard</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Use the email associated with your agency seat.
        </p>

        <form className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" placeholder="you@youragency.com" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="#" className="text-xs text-brand-teal hover:underline">
                Forgot?
              </Link>
            </div>
            <Input id="password" type="password" placeholder="••••••••" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox defaultChecked /> Keep me signed in for 30 days
          </label>
          <Link href="/dashboard">
            <Button className="w-full" size="lg">
              Sign in
            </Button>
          </Link>
        </form>

        <div className="mt-6 relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4">
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </Button>
        <p className="mt-6 text-xs text-center text-muted-foreground">
          New to Advertisely?{" "}
          <Link href="/signup" className="text-brand-teal hover:underline">
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  );
}
