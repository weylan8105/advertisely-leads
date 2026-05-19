import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand-red/15 text-brand-red",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-slate-300 text-foreground",
        success: "border-transparent bg-emerald-500/15 text-emerald-600",
        warning: "border-transparent bg-amber-500/15 text-amber-700",
        destructive: "border-transparent bg-rose-500/15 text-rose-600",
        info: "border-transparent bg-sky-500/15 text-sky-600",
        purple: "border-transparent bg-violet-500/15 text-violet-600",
        muted: "border-slate-300 bg-slate-100 text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
