/**
 * Refuse to build on Vercel without Supabase configured.
 *
 * `lib/supabase.js` returns null when the URL or key is missing, which makes
 * `configured` false, which makes `localUsers` true — and the app falls back to
 * web/lib/users.js: the seeded local user base, with passwords compared in
 * plaintext in the browser, the role kept in client-writable localStorage, and
 * two published test accounts. TASKS.md §1 is explicit that this scaffolding
 * must not ship.
 *
 * That fallback is deliberate and worth keeping. It is what makes the app
 * walkable with zero setup for a local demo, and docker-compose.yml passes the
 * build args through empty on purpose for the self-host profile. So this does
 * not fail the build everywhere — it fails it exactly where the fallback stops
 * being a convenience and becomes a public login form with a known password.
 *
 * VERCEL is set by Vercel on every build and by nothing else, which is the
 * narrowest signal available for "this build is going to end up on a URL
 * strangers can reach". A missing variable there is always a mistake.
 *
 * If a self-hosted deployment ever wants the same protection, the check to add
 * is its own equivalent flag — not the removal of this one.
 */
const onVercel = Boolean(process.env.VERCEL);

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
);

if (onVercel && !supabaseConfigured) {
  throw new Error(
    "Refusing to build: Supabase is not configured.\n\n" +
      "Set these in Vercel -> Project Settings -> Environment Variables:\n" +
      "  NEXT_PUBLIC_SUPABASE_URL\n" +
      "  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   (or NEXT_PUBLIC_SUPABASE_ANON_KEY)\n" +
      "  SUPABASE_SERVICE_ROLE_KEY              (mark as Sensitive)\n\n" +
      "Without them the app silently falls back to the local demo user base — " +
      "plaintext passwords in the browser, a role anyone can edit in devtools, " +
      "and a published test admin account. See DEPLOY.md step 3.\n"
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
