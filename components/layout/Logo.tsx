"use client";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

interface LogoProps {
  href?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
  tone?: "light" | "dark"; // dark = for placement on dark backgrounds
}

export function Logo({
  href,
  className,
  size = "md",
  withWordmark = true,
  tone = "light",
}: LogoProps) {
  // Route based on auth state so clicking the logo never *looks* like a logout.
  // Works for every login method (Google, email/password) — useSession only
  // reflects whether a session exists, not how it was created. If an explicit
  // href is passed, honor it; otherwise send signed-in users to their dashboard
  // and visitors to the marketing home.
  const { status } = useSession();
  const resolvedHref = href ?? (status === "authenticated" ? "/dashboard" : "/");
  const dims = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-9 w-9";
  return (
    <Link href={resolvedHref} className={cn("group inline-flex items-center gap-2.5", className)}>
      <div
        className={cn(
          "relative grid place-items-center rounded-lg bg-white shrink-0 overflow-hidden ring-1",
          tone === "dark" ? "ring-white/10" : "ring-slate-200",
          dims,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/advertisely-logo.png"
          alt="Advertisely"
          className="h-full w-full object-cover scale-[1.35]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      {withWordmark && (
        <div className="leading-tight">
          <div
            className={cn(
              "text-sm font-semibold tracking-tight",
              tone === "dark" ? "text-white" : "text-foreground",
            )}
          >
            Advertisely
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-brand-red">
            Leads
          </div>
        </div>
      )}
    </Link>
  );
}
