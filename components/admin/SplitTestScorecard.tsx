"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, cn } from "@/lib/utils";

interface Arm {
  key: "open" | "filtered";
  label: string;
  spendCents: number;
  leads: number;
  scored: number;
  qualified: number;
  trashed: number;
  dialed: number;
  contacted: number;
  appointments: number;
  presentations: number;
  apps: number;
  sold: number;
  premiumCents: number;
}
interface Test {
  key: string;
  label: string;
  account: string;
  since: string;
  studyEnds: string;
  arms: Arm[];
}
interface Data {
  configured: boolean;
  errors: string[];
  until: string;
  tests: Test[];
}

// Below this many leads per arm the rates swing too much to call anything.
const MIN_LEADS = 30;

const money = (c: number | null) => (c == null ? "—" : formatCurrency(c / 100));
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "—");
const per = (spend: number, n: number) => (spend > 0 && n > 0 ? Math.round(spend / n) : null);

type Better = "low" | "high" | null;
interface Metric {
  label: string;
  title?: string;
  /** Number used to pick the better arm (null = no value). */
  value: (a: Arm) => number | null;
  show: (a: Arm) => string;
  better: Better;
}

const METRICS: Metric[] = [
  { label: "Spend", value: (a) => a.spendCents, show: (a) => money(a.spendCents), better: null },
  { label: "Leads", value: (a) => a.leads, show: (a) => String(a.leads), better: null },
  { label: "Cost per lead", value: (a) => per(a.spendCents, a.leads), show: (a) => money(per(a.spendCents, a.leads)), better: "low" },
  {
    label: "Qualified",
    title: "Gross monthly income $3,000+ (or a qualifying work answer) and age 55 or under, out of the leads that answered both",
    value: (a) => (a.scored ? a.qualified / a.scored : null),
    show: (a) => `${a.qualified} of ${a.scored} (${pct(a.qualified, a.scored)})`,
    better: "high",
  },
  {
    label: "Cost per qualified lead",
    value: (a) => per(a.spendCents, a.qualified),
    show: (a) => money(per(a.spendCents, a.qualified)),
    better: "low",
  },
  {
    label: "Contacted",
    title: "Moved to Contacted, Call Back, Presentation or further at any point",
    value: (a) => (a.leads ? a.contacted / a.leads : null),
    show: (a) => `${a.contacted} (${pct(a.contacted, a.leads)})`,
    better: "high",
  },
  { label: "Cost per contacted lead", value: (a) => per(a.spendCents, a.contacted), show: (a) => money(per(a.spendCents, a.contacted)), better: "low" },
  {
    label: "Appointments",
    title: "Moved to Call Back / appointment or further",
    value: (a) => (a.leads ? a.appointments / a.leads : null),
    show: (a) => `${a.appointments} (${pct(a.appointments, a.leads)})`,
    better: "high",
  },
  { label: "Cost per appointment", value: (a) => per(a.spendCents, a.appointments), show: (a) => money(per(a.spendCents, a.appointments)), better: "low" },
  {
    label: "Applications",
    title: "Reached Underwriting, Approved, Issued Not Paid or Issued PAID",
    value: (a) => (a.leads ? a.apps / a.leads : null),
    show: (a) => `${a.apps} (${pct(a.apps, a.leads)})`,
    better: "high",
  },
  { label: "Cost per application", value: (a) => per(a.spendCents, a.apps), show: (a) => money(per(a.spendCents, a.apps)), better: "low" },
  { label: "Sales (Issued PAID)", value: (a) => a.sold, show: (a) => String(a.sold), better: null },
  { label: "Cost per sale", value: (a) => per(a.spendCents, a.sold), show: (a) => money(per(a.spendCents, a.sold)), better: "low" },
  {
    label: "Premium per $1",
    title: "Annual premium written for every $1 of ad spend",
    value: (a) => (a.spendCents > 0 && a.premiumCents > 0 ? a.premiumCents / a.spendCents : null),
    show: (a) => (a.spendCents > 0 && a.premiumCents > 0 ? `$${(a.premiumCents / a.spendCents).toFixed(2)}` : "—"),
    better: "high",
  },
  {
    label: "Trashed",
    title: "Leads deleted as junk (fake info, duplicates)",
    value: (a) => (a.leads ? a.trashed / a.leads : null),
    show: (a) => `${a.trashed} (${pct(a.trashed, a.leads)})`,
    better: "low",
  },
];

function winner(m: Metric, arms: Arm[]): number | null {
  if (!m.better || arms.length !== 2 || arms.some((a) => a.leads < MIN_LEADS)) return null;
  const [x, y] = arms.map(m.value);
  if (x == null || y == null || x === y) return null;
  return (m.better === "low" ? x < y : x > y) ? 0 : 1;
}

/** Admin: the open vs filtered split test judged on lead quality, not Meta's cost per lead. */
export function SplitTestScorecard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/split-test")
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the split test…
      </div>
    );
  }
  if (!data?.tests) return <p className="py-6 text-sm text-slate-500">Couldn&apos;t load the split test.</p>;

  return (
    <div className="space-y-6">
      {!data.configured && <p className="text-sm text-amber-700">Meta isn&apos;t connected, so spend shows as $0.</p>}
      {data.errors?.length > 0 && <p className="text-sm text-amber-700">Meta: {data.errors.join("; ")}</p>}
      {data.tests.map((t) => {
        const early = t.arms.some((a) => a.leads < MIN_LEADS);
        return (
          <div key={t.key}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-slate-900">{t.label}</h3>
              <span className="text-xs text-slate-500">
                {t.since} to {data.until} · Meta&apos;s A/B study ends {t.studyEnds}
              </span>
            </div>
            {early && (
              <p className="mb-2 text-xs text-slate-500">
                Too early to call: each side needs at least {MIN_LEADS} leads before the better number is highlighted.
              </p>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56">Metric</TableHead>
                    {t.arms.map((a) => (
                      <TableHead key={a.key} className="text-right">
                        {a.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {METRICS.map((m) => {
                    const w = winner(m, t.arms);
                    return (
                      <TableRow key={m.label}>
                        <TableCell className="text-slate-700" title={m.title}>
                          {m.label}
                        </TableCell>
                        {t.arms.map((a, i) => (
                          <TableCell
                            key={a.key}
                            className={cn("text-right tabular-nums", w === i && "font-semibold text-emerald-700")}
                          >
                            {m.show(a)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-500">
        Judge on cost per qualified lead, contacted lead and sale, not Meta&apos;s cost-per-lead winner. Sales lag the
        leads by a week or two, so the qualified and contacted rows settle first.
      </p>
    </div>
  );
}
