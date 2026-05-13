import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2 } from "lucide-react";

const perks = [
  "Real-time delivery on Fresh & Retirement-Focused packages",
  "Built-in lightweight CRM with notes, statuses, and agent assignment",
  "CSV + Google Sheets exports in one click",
  "Native GoHighLevel, Salesforce, HubSpot, and webhook integrations",
  "Replacement requests on bad numbers within 72 hours",
];

export default function SignupPage() {
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
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-brand-teal shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <Card className="p-8 max-w-md mx-auto w-full glass-strong">
        <div className="text-xs uppercase tracking-[0.18em] text-brand-teal mb-2">
          Create account
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Spin up your workspace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          You'll be browsing the marketplace in under 60 seconds.
        </p>

        <form className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first">First name</Label>
              <Input id="first" placeholder="Jordan" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last">Last name</Label>
              <Input id="last" placeholder="Pace" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" placeholder="you@youragency.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agency">Agency / IMO</Label>
            <Input id="agency" placeholder="Your agency or independent" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="••••••••" />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox defaultChecked className="mt-0.5" />
            <span>
              I agree to the{" "}
              <Link href="#" className="text-brand-teal hover:underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="#" className="text-brand-teal hover:underline">
                TCPA outreach policy
              </Link>
              . I will only contact leads after verifying captured consent.
            </span>
          </label>
          <Link href="/dashboard">
            <Button className="w-full" size="lg">
              Create account
            </Button>
          </Link>
        </form>

        <p className="mt-6 text-xs text-center text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-teal hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
