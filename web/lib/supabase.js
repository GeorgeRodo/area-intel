import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Supabase issues the browser-side key under two names depending on the
// project's age — the legacy `anon` JWT (eyJ...) and the newer publishable key
// (sb_publishable_...). The Connect snippet in the dashboard emits whichever
// one the project has, under a matching variable name, so accept both rather
// than have a verbatim copy-paste land the app silently back in demo mode.
// createClient does not care which it gets; both resolve to the `anon` role,
// and 0005 is what makes that role useless without a session.
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key) : null;
export const configured = Boolean(supabase);
