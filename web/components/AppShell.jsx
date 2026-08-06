"use client";
import { useState } from "react";
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

function Gate({ children }) {
  const { session, loading } = useAuth();

  if (loading) return null;
  // Signed out: the login page owns the whole viewport, no sidebar, no nav.
  if (!session) return <Login />;

  return <SignedIn>{children}</SignedIn>;
}

export default function AppShell({ children }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
