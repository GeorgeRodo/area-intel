"use client";
import { demoMode } from "@/lib/api";

export default function DemoRibbon() {
  if (!demoMode) return null;
  return (
    <div className="border-b bg-muted px-4 py-1.5 text-center font-mono text-[11px] tracking-wide text-muted-foreground">
      DEMO DATA — not connected to the knowledge base, and sign-in runs on a
      local test user base. All content illustrative; the review loop is fully
      clickable.
    </div>
  );
}
