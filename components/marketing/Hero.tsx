"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Zap, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-radial-glow pointer-events-none" />
      <div
        className="absolute inset-0 bg-grid-light pointer-events-none"
        style={{ backgroundSize: "32px 32px" }}
      />
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[480px] w-[1100px] rounded-full bg-brand-red/10 blur-3xl pointer-events-none" />

      <div className="container relative pt-20 pb-24 lg:pt-28 lg:pb-32">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl"
        >
          <div className="inline-flex items-center gap-2 mb-6">
            <span className="h-px w-8 bg-brand-red" />
            <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
              Built for life insurance agents
            </span>
          </div>
          <h1 className="font-serif text-5xl md:text-7xl font-medium tracking-tight leading-[1.02]">
            High-intent IUL leads built for{" "}
            <span className="text-brand-red">agents who actually close.</span>
          </h1>
          <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-2xl">
            Advertisely Leads is the premium IUL lead marketplace for life insurance agents,
            agency builders, and IUL producers. Real-time delivery, documented TCPA consent,
            and a built-in CRM that ships your leads anywhere you need them.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/marketplace">
              <Button size="xl">
                Browse Leads <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="xl" variant="outline">
                Create Account
              </Button>
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-red" /> TCPA-compliant capture
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-brand-red" /> Source-tracked records
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-brand-red" /> Real-time delivery
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-16 lg:mt-20"
        >
          <HeroDashboardMock />
        </motion.div>
      </div>
    </section>
  );
}

function HeroDashboardMock() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <div className="absolute -inset-x-12 -top-12 -bottom-12 bg-gradient-to-b from-brand-red/10 via-transparent to-transparent blur-3xl pointer-events-none" />
      <div className="relative rounded-2xl border border-slate-300 bg-white backdrop-blur-xl overflow-hidden shadow-[0_40px_120px_-30px_rgba(220,38,38,0.35)]">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-3 font-mono">app.advertiselyleads.com/dashboard</span>
        </div>
        <div className="grid md:grid-cols-3 gap-4 p-5">
          <MockStat label="Leads this week" value="118" delta="+24%" tone="teal" />
          <MockStat label="Appointments set" value="22" delta="+18%" tone="violet" />
          <MockStat label="Closed AP (30d)" value="$48,200" delta="+12%" tone="emerald" />
        </div>
        <div className="px-5 pb-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Recent IUL leads</div>
              <span className="text-[10px] text-brand-red">Live · auto-refreshing</span>
            </div>
            <div className="divide-y divide-slate-200">
              {[
                ["Marcus H.", "TX", "Lineman", "New"],
                ["Tasha G.", "FL", "RN", "Contacted"],
                ["Devon W.", "OH", "Business Owner", "Appointment"],
              ].map((row, i) => (
                <div key={i} className="grid grid-cols-4 gap-3 py-2 text-xs">
                  <span className="font-medium">{row[0]}</span>
                  <span className="text-muted-foreground">{row[1]}</span>
                  <span className="text-muted-foreground">{row[2]}</span>
                  <span className="text-right">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        row[3] === "New"
                          ? "bg-brand-red/15 text-brand-red"
                          : row[3] === "Contacted"
                          ? "bg-sky-500/15 text-sky-600"
                          : "bg-violet-500/15 text-violet-600"
                      }`}
                    >
                      {row[3]}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockStat({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: "teal" | "violet" | "emerald";
}) {
  const colors = {
    teal: "from-brand-red/15 text-brand-red",
    violet: "from-violet-500/15 text-violet-600",
    emerald: "from-emerald-500/15 text-emerald-600",
  };
  return (
    <div className="relative rounded-xl border border-slate-200 bg-slate-50 overflow-hidden p-4">
      <div className={`absolute inset-0 bg-gradient-to-br ${colors[tone].split(" ")[0]} to-transparent`} />
      <div className="relative">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
        <div className={`mt-1 text-[11px] ${colors[tone].split(" ")[1]}`}>{delta} vs last week</div>
      </div>
    </div>
  );
}
