"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * next-themes writes the `dark` class onto <html> before first paint via an
 * inline script, which is why app/layout.jsx carries suppressHydrationWarning:
 * the server cannot know which class that script will pick.
 */
export default function ThemeProvider({ children, ...props }) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
