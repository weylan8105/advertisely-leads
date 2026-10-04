"use client";

import { TrendingUp, ArrowRight } from "lucide-react";

/**
 * Shown atop everyone's pipeline. Nudges agents to keep leads moving through the
 * closing stages (Approved → Issued Not Paid → Issued PAID) so we can see who's
 * converting and feed that back into lead quality. Subtle styling, but the
 * headline + accent make it hard to overlook. Not dismissible by design.
 */
export function PipelineIncentiveBanner() {
  const Stage = ({ children }: { children: React.ReactNode }) => (
    <span className="inline-flex items-center rounded-md border border-brand-red/25 bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-red">
      {children}
    </span>
  );
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-brand-red/30 border-l-4 border-l-brand-red bg-gradient-to-r from-brand-red/[0.07] via-brand-red/[0.02] to-transparent">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <div className="shrink-0 rounded-lg bg-brand-red/10 p-2">
          <TrendingUp className="h-5 w-5 text-brand-red" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold tracking-tight text-foreground sm:text-base">
              How to make more money without spending any more
            </h3>
            <span className="inline-flex items-center rounded-full bg-brand-red px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Better leads
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            As you work a lead, drag it into <span className="font-semibold text-foreground">Approved</span>,{" "}
            <span className="font-semibold text-foreground">Issued Not Paid</span>, and{" "}
            <span className="font-semibold text-foreground">Issued PAID&nbsp;💰</span> when it closes. That tells
            us exactly which leads are converting — and we use it to sharpen who we target, so the leads you
            receive keep getting better. <span className="font-medium text-foreground">Same spend, higher
            quality, more closes.</span>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <Stage>Approved</Stage>
            <ArrowRight className="h-3 w-3" />
            <Stage>Issued Not Paid</Stage>
            <ArrowRight className="h-3 w-3" />
            <Stage>Issued PAID 💰</Stage>
          </div>
        </div>
      </div>
    </div>
  );
}
