"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, FileText, MessageCircleQuestion } from "lucide-react";
import { Select, Field, ErrorNote } from "@/components/ui";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/AuthContext";
import { useMunicipalities } from "@/lib/MunicipalitiesContext";
import { cn } from "@/lib/utils";

function Wordmark() {
  return (
    <Link href="/" className="block">
      <div className="text-base font-semibold leading-none tracking-tight">
        Area<span className="text-muted-foreground">·</span>Intel
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
        verified intelligence, tiered
      </div>
    </Link>
  );
}

/**
 * Primary navigation. Identity and sign-out deliberately do not live here —
 * they are in the top bar (see components/UserMenu).
 *
 * `open` / `onOpenChange` drive the Sheet below the md breakpoint, where a
 * fixed 15rem rail would eat most of the viewport.
 */
export default function Sidebar({ open = false, onOpenChange }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { municipalities, error } = useMunicipalities();
  const currentId = pathname.startsWith("/brief/") ? pathname.split("/")[2] : null;

  // A route change means the drawer has done its job.
  useEffect(() => { onOpenChange?.(false); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // The drawer is a Radix dialog: while it is open it holds a focus trap, sets
  // aria-hidden on the app and puts pointer-events:none on the body. Hiding
  // only its panel with `md:hidden` therefore left the overlay painted over a
  // page that could no longer be clicked or read — so desktop has to actually
  // close it, not just hide it.
  //
  // Starts false so the first client render matches the server, where there is
  // no viewport to measure.
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (isDesktop) onOpenChange?.(false);
  }, [isDesktop, onOpenChange]);

  const briefHref = currentId
    ? `/brief/${currentId}`
    : municipalities[0]
    ? `/brief/${municipalities[0].id}`
    : "/areas";
  const briefMatch = (p) => p.startsWith("/brief") || p === "/areas";

  const nav = isAdmin
    ? [
        { href: "/", label: "Admin panel", icon: LayoutGrid, match: (p) => p === "/" },
        { href: "/ask", label: "Ask", icon: MessageCircleQuestion, match: (p) => p === "/ask" },
        { href: briefHref, label: "Area Brief", icon: FileText, match: briefMatch },
      ]
    : [
        { href: "/", label: "Area Brief", icon: FileText, match: (p) => p === "/" || briefMatch(p) },
        { href: "/ask", label: "Ask", icon: MessageCircleQuestion, match: (p) => p === "/ask" },
      ];

  const body = (
    <>
      <Wordmark />

      <Field label="Municipality">
        {({ id, ...aria }) =>
          error ? (
            <ErrorNote className="text-xs">API offline: {error}</ErrorNote>
          ) : (
            <Select
              id={id}
              {...aria}
              value={currentId || ""}
              onChange={(e) => router.push(`/brief/${e.target.value}`)}
            >
              {!currentId && <option value="">select…</option>}
              {municipalities.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )
        }
      </Field>

      <nav aria-label="Primary" className="flex flex-col gap-1">
        {nav.map((n) => {
          const active = n.match(pathname);
          return (
            <Link
              key={n.label}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <n.icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <p className="mt-auto font-mono text-[10px] leading-relaxed text-muted-foreground">
        Nothing reaches this brief
        <br />
        until a team member verifies it.
      </p>
    </>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col gap-7 border-r bg-background px-5 py-7 md:flex">
        {body}
      </aside>

      {/* Gating on `isDesktop` as well as `open` means a stale-open drawer can
          never mount its trap at a width where the rail is already showing. */}
      <Sheet open={open && !isDesktop} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="flex w-64 flex-col gap-7 px-5 py-7">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {body}
        </SheetContent>
      </Sheet>
    </>
  );
}
