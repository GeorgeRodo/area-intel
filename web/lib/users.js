/**
 * LOCAL USER BASE — TEMPORARY SCAFFOLDING. MUST BE REPLACED BEFORE ANY PILOT.
 * See TASKS.md → "Replace the local user base with real auth".
 *
 * Active only in demo mode (no Supabase env vars). It exists so the two roles
 * are actually walkable without standing up Supabase Auth:
 *
 *   admin@areaintel.pt / admin1234   → role "admin" (knowledge base management)
 *   user@areaintel.pt  / user1234    → role "user"  (briefs + ask only)
 *
 * Passwords are stored in plaintext in localStorage and compared in the
 * browser. There is no server, no hashing, no session expiry, and anything
 * the client can read it can also rewrite — a user can grant themselves
 * "admin" from devtools. This is a design-demo fixture, not authentication.
 * With NEXT_PUBLIC_SUPABASE_URL/ANON_KEY set, none of this file runs: auth
 * goes to Supabase Auth and roles come from profiles.role (see 0004 migration).
 */

const USERS_KEY = "areaintel.users.v1";
const SESSION_KEY = "areaintel.session.v1";

export const SEED_USERS = [
  {
    email: "admin@areaintel.pt",
    password: "admin1234",
    role: "admin",
    display_name: "Test Admin",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    email: "user@areaintel.pt",
    password: "user1234",
    role: "user",
    display_name: "Test User",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

const hasStorage = () => typeof window !== "undefined" && !!window.localStorage;
const norm = (email) => String(email || "").trim().toLowerCase();

function readUsers() {
  if (!hasStorage()) return [...SEED_USERS];
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) {
      window.localStorage.setItem(USERS_KEY, JSON.stringify(SEED_USERS));
      return [...SEED_USERS];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : [...SEED_USERS];
  } catch {
    return [...SEED_USERS];
  }
}

function writeUsers(users) {
  if (hasStorage()) window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  return users;
}

const publicUser = ({ password, ...u }) => u; // never hand the password back out

export const localAuth = {
  // ---------- session ----------
  session: async () => {
    if (!hasStorage()) return null;
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const sess = JSON.parse(raw);
      // a deleted or renamed account must not keep a live session
      if (!readUsers().some((u) => u.email === sess?.user?.email)) {
        window.localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return sess;
    } catch {
      return null;
    }
  },

  signIn: async (email, password) => {
    const u = readUsers().find((x) => x.email === norm(email));
    if (!u || u.password !== password) {
      throw new Error("Invalid email or password.");
    }
    const sess = {
      user: { id: u.email, email: u.email },
      signed_in_at: new Date().toISOString(),
    };
    if (hasStorage()) window.localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    return sess;
  },

  signOut: async () => {
    if (hasStorage()) window.localStorage.removeItem(SESSION_KEY);
  },

  myProfile: async () => {
    const sess = await localAuth.session();
    if (!sess) return null;
    const u = readUsers().find((x) => x.email === sess.user.email);
    return u ? publicUser(u) : null;
  },

  // ---------- admin: user management ----------
  listUsers: async () => readUsers().map(publicUser),

  setRole: async (email, role) => {
    if (!["admin", "user"].includes(role)) throw new Error(`invalid role: ${role}`);
    const users = readUsers();
    const u = users.find((x) => x.email === norm(email));
    if (!u) throw new Error("user not found");
    u.role = role;
    writeUsers(users);
    return publicUser(u);
  },

  createUser: async ({ email, password, display_name, role = "user" }) => {
    const users = readUsers();
    const e = norm(email);
    if (!e.includes("@")) throw new Error("a valid email is required");
    if (!password || password.length < 6) throw new Error("password must be at least 6 characters");
    if (users.some((x) => x.email === e)) throw new Error("that email already exists");
    const u = {
      email: e,
      password,
      role,
      display_name: display_name?.trim() || e.split("@")[0],
      created_at: new Date().toISOString(),
    };
    users.push(u);
    writeUsers(users);
    return publicUser(u);
  },

  deleteUser: async (email) => {
    const e = norm(email);
    const users = readUsers();
    const next = users.filter((x) => x.email !== e);
    if (next.length === users.length) throw new Error("user not found");
    if (!next.some((x) => x.role === "admin")) {
      throw new Error("cannot delete the last admin");
    }
    writeUsers(next);
    return { deleted: e };
  },

  /** Restore the two seed accounts and drop everything else. */
  reset: async () => {
    writeUsers([...SEED_USERS]);
    if (hasStorage()) window.localStorage.removeItem(SESSION_KEY);
    return SEED_USERS.map(publicUser);
  },
};
