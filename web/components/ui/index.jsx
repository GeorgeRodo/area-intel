"use client";
import { useId } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert as AlertRoot, AlertDescription } from "@/components/ui/alert";

/**
 * The app-level layer over the shadcn primitives.
 *
 * The primitives in this folder are the unmodified shadcn components — the
 * things you would get from `npx shadcn add`. What lives here is the handful
 * of compositions this product repeats on every screen: a labelled field, a
 * page header, an empty state. Keeping them apart means a primitive can be
 * re-added from the registry without stepping on anything.
 */

export {
  Button,
  buttonVariants,
  Card,
  Input,
  Textarea,
  Select,
  Label,
  Badge,
  Skeleton,
};

export {
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
export { Separator } from "@/components/ui/separator";
export { Progress } from "@/components/ui/progress";

/* ------------------------------------------------------------------ *
 * Form composition
 * ------------------------------------------------------------------ */

/**
 * Label + control, wired together. Every control in the app used to sit next
 * to a bare <label> with no htmlFor, so clicking the label did nothing and
 * screen readers announced an unlabelled input. Passing a render function
 * hands the generated id down to whatever control you put inside.
 */
export function Field({ label, hint, error, className, children }) {
  const id = useId();
  const describedBy = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && (
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
      )}
      {typeof children === "function"
        ? children({ id, "aria-describedby": describedBy })
        : children}
      {(hint || error) && (
        <p
          id={`${id}-desc`}
          className={cn(
            "text-xs leading-snug",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Type & status
 * ------------------------------------------------------------------ */

/** Metadata voice: ids, timestamps, provenance. Never body copy. */
export function Mono({ className, children, ...props }) {
  return (
    <span className={cn("font-mono text-xs text-muted-foreground", className)} {...props}>
      {children}
    </span>
  );
}

/** A shadcn Alert with the icon and layout this app always uses. */
export function Alert({ tone = "warn", title, children, className }) {
  const variant = { warn: "warning", bad: "destructive", info: "default" }[tone] ?? "default";
  return (
    <AlertRoot variant={variant} className={className}>
      <AlertTriangle aria-hidden="true" />
      <AlertDescription>
        {title && <strong className="font-medium text-foreground">{title}</strong>}{" "}
        {children}
      </AlertDescription>
    </AlertRoot>
  );
}

/** Inline error for a failed load. role=alert so it is announced. */
export function ErrorNote({ children, className }) {
  return (
    <p role="alert" className={cn("text-sm text-destructive", className)}>
      {children}
    </p>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ *
 * Loading & empty states
 * ------------------------------------------------------------------ */

/** A stand-in with the shape of the cards that are coming. */
export function SkeletonCards({ count = 3, height = "h-24", className }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn(height, "rounded-xl")} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action, className }) {
  return (
    <div className={cn("px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg border bg-muted/40">
          <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{children}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page structure
 * ------------------------------------------------------------------ */

/**
 * The one page header. `actions` is where contextual controls go — the
 * municipality picker, filters, primary buttons — so a control that only
 * matters on one page appears on that page instead of in the global nav.
 */
export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <header className={cn("mb-8", className)}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight">
            {title}
          </h1>
        </div>
        {actions && <div className="flex flex-wrap items-end gap-3">{actions}</div>}
      </div>
      {description && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </header>
  );
}

export function SectionHeader({ icon: Icon, title, right, className }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {Icon && (
          <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        )}
        <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
      </div>
      {right}
    </div>
  );
}
