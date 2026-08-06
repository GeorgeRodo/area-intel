"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Whether there is an in-app page to go back to.
 *
 * `window.history.length` cannot answer this — it counts the whole tab's
 * history, so a brief opened from a bookmark in a tab that has been elsewhere
 * would send the reader out of the app. This tracks route changes since the
 * shell mounted instead, which resets on a real page load: exactly the case
 * where a back button has nowhere sensible to go.
 */
const NavigationContext = createContext(false);

export function NavigationHistoryProvider({ children }) {
  const pathname = usePathname();
  const entryPath = useRef(pathname);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (pathname !== entryPath.current) setCanGoBack(true);
  }, [pathname]);

  return (
    <NavigationContext.Provider value={canGoBack}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useCanGoBack() {
  return useContext(NavigationContext);
}
