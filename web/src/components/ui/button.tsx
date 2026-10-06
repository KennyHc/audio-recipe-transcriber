import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "text-[hsl(var(--primary-ink))] bg-[linear-gradient(180deg,hsl(var(--primary-from)),hsl(var(--primary-to)))] shadow-[var(--shadow-primary)] hover:shadow-[var(--shadow-primary-hover)] hover:brightness-[1.04] active:brightness-[0.97] active:shadow-[inset_0_1px_3px_rgb(0_0_0_/_0.18)] transition-[filter,box-shadow,transform]",
        secondary:
          "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:opacity-80",
        outline:
          "border border-[hsl(var(--border-strong))] bg-transparent text-[hsl(var(--ink))] hover:bg-[hsl(var(--accent-tint))] hover:border-[hsl(var(--accent-fill))]/50",
        ghost: "text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]",
        destructive:
          "bg-[hsl(var(--danger))] text-white hover:opacity-90",
        link: "text-[hsl(var(--accent-text))] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-[var(--radius-control)] px-3 text-xs",
        lg: "h-12 rounded-[var(--radius-control)] px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
