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
