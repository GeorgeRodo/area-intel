"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * The resolved theme is only known on the client, so the icon is held back
 * until after mount — rendering a sun that flips to a moon on hydration is a
 * worse flash than a beat of empty space in the corner of the bar.
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Switch theme"}
    >
      {mounted &&
        (isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />)}
    </Button>
  );
}
