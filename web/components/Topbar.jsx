"use client";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import UserMenu from "@/components/UserMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

function sectionLabel(pathname, isAdmin) {
  if (pathname.startsWith("/ask")) return "Ask";
  if (pathname.startsWith("/brief") || pathname.startsWith("/areas")) return "Area brief";
  if (pathname === "/") return isAdmin ? "Admin panel" : "Area brief";
  return "Area·Intel";
}

/**
 * The app's one horizontal bar: where you are on the left, who you are on the
 * right. Identity used to sit in the sidebar footer, which put the least
 * frequently used control in the most permanent piece of chrome.
 */
export default function Topbar({ onOpenNav }) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-2 md:hidden"
        >
          <Menu aria-hidden="true" />
        </Button>
        <span className="truncate text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {sectionLabel(pathname, isAdmin)}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
