import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const appCardVariants = cva("card min-w-0", {
  variants: {
    padding: {
      none: "",
      compact: "p-4",
      default: "p-[var(--space-card)]",
      comfortable: "p-[var(--space-card-comfortable)]",
    },
  },
  defaultVariants: { padding: "default" },
});

function AppCard({ className, padding, asChild = false, ...props }: React.ComponentProps<"section"> & VariantProps<typeof appCardVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "section";
  return <Comp data-slot="app-card" className={cn(appCardVariants({ padding }), className)} {...props} />;
}

function AppCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="app-card-header" className={cn("flex min-w-0 items-start gap-3", className)} {...props} />;
}

function AppCardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="app-card-title" className={cn("text-lg font-bold tracking-tight", className)} {...props} />;
}

function AppCardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="app-card-description" className={cn("mt-1 text-sm leading-5 text-muted-foreground", className)} {...props} />;
}

export { AppCard, AppCardDescription, AppCardHeader, AppCardTitle, appCardVariants };
