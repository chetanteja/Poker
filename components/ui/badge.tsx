import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-indigo-900/50 text-indigo-300 border border-indigo-700",
        success: "bg-emerald-900/50 text-emerald-300 border border-emerald-700",
        destructive: "bg-red-900/50 text-red-300 border border-red-700",
        warning: "bg-amber-900/50 text-amber-300 border border-amber-700",
        secondary: "bg-zinc-800 text-zinc-300 border border-zinc-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
