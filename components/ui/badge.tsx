import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand-teal/15 text-brand-teal",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-white/15 text-foreground",
        success: "border-transparent bg-emerald-500/15 text-emerald-300",
        warning: "border-transparent bg-amber-500/15 text-amber-300",
        destructive: "border-transparent bg-rose-500/15 text-rose-300",
        info: "border-transparent bg-sky-500/15 text-sky-300",
        purple: "border-transparent bg-violet-500/15 text-violet-300",
        muted: "border-white/10 bg-white/[0.04] text-muted-foreground",
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
