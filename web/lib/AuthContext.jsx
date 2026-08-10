"use client";
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { api, localUsers } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * App-wide auth: two roles live in profiles.role -
 *  - "user"  can ask questions and read verified briefs
 *  - "admin" additionally manages the knowledge base (review queue, run-now)
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const loadProfile = useCallback(async () => {
    setProfile(await api.myProfile().catch(() => null));
    setProfileLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.session().then(async (sess) => {
      if (cancelled) return;
      setSession(sess);
      if (sess) await loadProfile();
    });
    if (!localUsers && supabase) {
      const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
        setSession(sess);
        if (sess) loadProfile();
        else setProfile(null);
      });
      return () => {
        cancelled = true;
        sub.subscription.unsubscribe();
      };
    }
    return () => { cancelled = true; };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    await api.signIn(email, password);
    const sess = await api.session();
    setSession(sess);
    await loadProfile();
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(null);
    setProfile(null);
    setProfileLoaded(false);
  }, []);

  // A new object literal every render would re-render every consumer of this
  // context on every parent render, which for an auth context is most of the app.
  const value = useMemo(() => {
    const loading = session === undefined || Boolean(session && !profileLoaded);
    return {
      session,
      profile,
      loading,
      isAdmin: profile?.role === "admin",
      signIn,
      signOut,
    };
  }, [session, profile, profileLoaded, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
