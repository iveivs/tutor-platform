import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const typographyVariants = cva("text-foreground", {
  variants: {
    variant: {
      pageTitle: "text-3xl font-bold tracking-tight md:text-4xl",
      sectionTitle: "text-xl font-bold tracking-tight md:text-2xl",
      cardTitle: "text-lg font-bold tracking-tight",
      body: "text-base leading-6",
      muted: "text-sm leading-5 text-muted-foreground",
      caption: "text-xs leading-4 text-muted-foreground",
    },
  },
  defaultVariants: { variant: "body" },
});

function Typography({ variant, asChild = false, className, ...props }: React.ComponentProps<"p"> & VariantProps<typeof typographyVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "p";
  return <Comp data-slot="typography" data-variant={variant} className={cn(typographyVariants({ variant }), className)} {...props} />;
}

export { Typography, typographyVariants };
