"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface LogoProps {
  href?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
}

export function Logo({ href = "/", className, size = "md", withWordmark = true }: LogoProps) {
  const dims = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-9 w-9";
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5", className)}>
      <div
        className={cn(
          "relative grid place-items-center rounded-lg bg-white shrink-0 overflow-hidden ring-1 ring-white/10",
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
          <div className="text-sm font-semibold tracking-tight">Advertisely</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-brand-teal">Leads</div>
        </div>
      )}
    </Link>
  );
}
