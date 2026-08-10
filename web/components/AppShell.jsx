"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { MunicipalitiesProvider } from "@/lib/MunicipalitiesContext";
import { NavigationHistoryProvider } from "@/lib/NavigationContext";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import Login from "@/components/Login";

function SignedIn({ children }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <MunicipalitiesProvider>
      <NavigationHistoryProvider>
        <div className="flex min-h-screen">
          <Sidebar open={navOpen} onOpenChange={setNavOpen} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar onOpenNav={() => setNavOpen(true)} />
            <main className="w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-10">
              {children}
            </main>
          </div>
        </div>
      </NavigationHistoryProvider>
    </MunicipalitiesProvider>
  );
}

/**
 * Routes that render without a session. Signing up is the one thing a person
 * with no account has to be able to reach, and the gate would otherwise show
 * them the login form on a page that exists precisely because they cannot log
 * in yet. Nothing is exposed by letting them through: every one of these
 * pages talks to Supabase Auth, and the invite-only rule is enforced by the
 * database (0005), not by whether this component renders.
 */
const PUBLIC_PATHS = new Set(["/signup"]);

/** Signed-out chrome: no sidebar, no nav, just the page. */
function PublicShell({ children }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8">{children}</main>
  );
}

function Gate({ children }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();

  if (loading) return null;

  if (!session) {
    if (PUBLIC_PATHS.has(pathname)) return <PublicShell>{children}</PublicShell>;
    // Signed out: the login page owns the whole viewport, no sidebar, no nav.
    return <Login />;
  }

  return <SignedIn>{children}</SignedIn>;
}

export default function AppShell({ children }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
