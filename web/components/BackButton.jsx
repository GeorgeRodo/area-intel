"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useCanGoBack } from "@/lib/NavigationContext";

const CLASSES =
  "inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground " +
  "hover:text-foreground transition-colors";

/**
 * Goes back to wherever the reader came from. On a cold load — a bookmark, a
 * shared link — there is no in-app history, so it degrades to a named link
 * rather than a button that would leave the app.
 */
export default function BackButton({
  fallbackHref = "/areas",
  fallbackLabel = "All coverage areas",
  label = "Back",
  className = "",
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  const icon = <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />;

  if (!canGoBack) {
    return (
      <Link href={fallbackHref} className={`${CLASSES} ${className}`}>
        {icon}
        {fallbackLabel}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} className={`${CLASSES} ${className}`}>
      {icon}
      {label}
    </button>
  );
}
