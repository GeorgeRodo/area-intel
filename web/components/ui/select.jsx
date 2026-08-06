import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A native <select> wearing the shadcn trigger.
 *
 * Upstream shadcn ships a Radix listbox with a compound API
 * (Select / SelectTrigger / SelectValue / SelectContent / SelectItem). Every
 * select in this app is a short, flat list of plain <option>s built by a
 * `.map()` — tiers, statuses, categories, municipalities — and several sit
 * inside a <form>. A native control keeps form semantics, mobile's native
 * picker and the existing call sites, and is visually identical.
 *
 * `className` lands on the wrapper rather than the control, because what a
 * call site wants to override is the field's width; the <select> itself is
 * always w-full inside it.
 */
const Select = React.forwardRef(function Select(
  { className, children, ...props },
  ref
) {
  return (
    <div className={cn("relative w-full", className)}>
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full appearance-none items-center rounded-md border border-input bg-transparent",
          "py-1 pl-3 pr-8 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // The options list is painted by the OS, which does not read our
          // CSS variables — naming the colours keeps it legible in dark mode.
          "[&>option]:bg-popover [&>option]:text-popover-foreground"
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-50"
        aria-hidden="true"
      />
    </div>
  );
});

export { Select };
