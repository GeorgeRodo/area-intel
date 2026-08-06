"use client";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Database, ClipboardCheck, Bot, Users } from "lucide-react";
import MissionControlOverview from "@/components/MissionControlOverview";
import KnowledgeBasePanel from "@/components/KnowledgeBasePanel";
import KnowledgeBaseQueue from "@/components/KnowledgeBaseQueue";
import AutomationPanel from "@/components/AutomationPanel";
import UsersPanel from "@/components/UsersPanel";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Every section carries its own title and standfirst so the content area
 * always says what you are looking at — the panel chrome is navigation, not
 * explanation. `blurb` is the one-liner shown in the rail.
 */
const SECTIONS = [
  {
    key: "overview",
    label: "Overview",
    icon: LayoutGrid,
    blurb: "Ran, failed, waiting",
    title: "What ran, what didn't, what's waiting on you",
    description:
      "The knowledge base and everything that feeds it, at a glance: the routines, the run log, and the queue that needs a human.",
    Panel: MissionControlOverview,
  },
  {
    key: "kb",
    label: "Knowledge Base",
    icon: Database,
    blurb: "Every claim on record",
    title: "Knowledge base",
    description:
      "Every claim on record, in every status. Re-tier a claim when its evidence changes, retire it when it stops being true.",
    Panel: KnowledgeBasePanel,
  },
  {
    key: "queue",
    label: "Review Queue",
    icon: ClipboardCheck,
    blurb: "The human gate",
    title: "Review queue",
    description:
      "The human gate. Approvals become verified nodes with provenance, and the database enforces that this is the only path in.",
    Panel: KnowledgeBaseQueue,
  },
  {
    key: "automation",
    label: "Automation",
    icon: Bot,
    blurb: "Routines and agents",
    title: "Automation",
    description:
      "Agents and scheduled routines that feed the base. None of them can publish — a routine's output is a draft finding.",
    Panel: AutomationPanel,
  },
  {
    key: "users",
    label: "Users",
    icon: Users,
    blurb: "Accounts and roles",
    title: "Users",
    description:
      "Two roles. Admins manage the knowledge base and see everything; users get area briefs and Ask, and nothing else.",
    Panel: UsersPanel,
  },
];

const DEFAULT_SECTION = SECTIONS[0];

export default function AdminDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the source of truth for which section is open, so /?tab=queue
  // is a real deep link and the back button walks the sections.
  const requested = searchParams.get("tab");
  const section = SECTIONS.find((s) => s.key === requested) || DEFAULT_SECTION;

  const open = useCallback(
    (key) => {
      const query = key === DEFAULT_SECTION.key ? "/" : `/?tab=${key}`;
      router.replace(query, { scroll: false });
    },
    [router]
  );

  const { Panel } = section;

  return (
    <div>
      <PageHeader
        eyebrow="Admin panel"
        title={section.title}
        description={section.description}
      />

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
        <nav
          aria-label="Admin sections"
          className="w-full lg:w-56 shrink-0 lg:sticky lg:top-20"
        >
          <ul className="flex lg:flex-col gap-1 overflow-x-auto scrollbar-thin lg:overflow-visible -mx-1 px-1 pb-1 lg:pb-0">
            {SECTIONS.map((s) => {
              const active = s.key === section.key;
              return (
                <li key={s.key} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => open(s.key)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2",
                      "text-left transition-colors lg:items-start lg:whitespace-normal",
                      active
                        ? "border-border bg-card shadow-sm"
                        : "border-transparent hover:bg-accent"
                    )}
                  >
                    <s.icon
                      className={cn(
                        "size-4 shrink-0 lg:mt-0.5",
                        active ? "text-foreground" : "text-muted-foreground"
                      )}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-[13.5px] font-medium leading-tight",
                          active ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {s.label}
                      </span>
                      <span className="mt-0.5 hidden text-[11.5px] leading-snug text-muted-foreground lg:block">
                        {s.blurb}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="flex-1 min-w-0 w-full">
          <Panel onOpenQueue={() => open("queue")} />
        </section>
      </div>
    </div>
  );
}
