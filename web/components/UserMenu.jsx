"use client";
import { useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** "Ana Maria Silva" -> "AM". Falls back to the email's first letter. */
function initials(name, email) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return String(email || "?").charAt(0).toUpperCase();
  return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
}

/**
 * Who you are and how to leave, top right. Radix owns the open state, focus
 * trapping and dismissal, so the keyboard behaviour is the platform menu
 * behaviour rather than a hand-rolled approximation of it.
 */
export default function UserMenu() {
  const { profile, session, isAdmin, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!profile) return null;

  const email = profile.email || session?.user?.email || null;
  const name = profile.display_name || email || "Account";
  const role = isAdmin ? "admin" : "user";

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex items-center gap-2 rounded-full border border-transparent py-1 pl-1 pr-2 transition-colors",
            "hover:border-border hover:bg-accent",
            "data-[state=open]:border-border data-[state=open]:bg-accent",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <UserAvatar profile={profile} email={email} />
          <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
            <span className="max-w-[10rem] truncate text-[13px] font-medium">{name}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{role}</span>
          </span>
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 p-2">
          <UserAvatar profile={profile} email={email} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name}</div>
            {email && (
              <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                {email}
              </div>
            )}
          </div>
        </div>
        <div className="px-2 pb-2">
          <Badge variant={isAdmin ? "default" : "secondary"} className="font-normal">
            {isAdmin ? "admin · manages the knowledge base" : "user · briefs and Ask"}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy}
          // Radix closes the menu on select before the async sign-out settles,
          // which unmounts the item mid-flight; holding it open keeps the
          // disabled state visible until the session actually goes away.
          onSelect={(e) => {
            e.preventDefault();
            handleSignOut();
          }}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut aria-hidden="true" />
          {busy ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserAvatar({ profile, email, size = "md" }) {
  return (
    <Avatar className={cn("shrink-0", size === "lg" ? "size-9" : "size-8")}>
      {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
      <AvatarFallback
        className={cn(
          "bg-primary text-primary-foreground",
          size === "lg" ? "text-[13px]" : "text-[11.5px]"
        )}
      >
        {initials(profile.display_name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
