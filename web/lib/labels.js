export const CATEGORIES = {
  market: "Market",
  regulatory: "Regulatory",
  enforcement: "Enforcement (câmara)",
  physical: "Physical / brown stock",
  financing: "Financing reality",
  condo: "Condominium health",
  tax: "Tax practice",
  liquidity: "Exit liquidity",
  professionals: "Professional ecosystem",
  operational: "Operational friction",
  esg: "ESG / stranded asset",
  infrastructure: "Infrastructure",
};

/**
 * The reliability ladder, rendered as a luminance ramp rather than four
 * unrelated hues — A carries the most ink, D the least. `fg` is paired with
 * `bg` deliberately: tier D is a light chip and needs dark type on it, so the
 * two cannot be chosen independently at the call site.
 *
 * These class names are why tailwind.config.js scans lib/ — a class that
 * appears nowhere else is simply never generated.
 */
export const TIERS = {
  A: { label: "A", desc: "verified primary", bg: "bg-tier-a", fg: "text-tier-a-foreground" },
  B: { label: "B", desc: "verified secondary", bg: "bg-tier-b", fg: "text-tier-b-foreground" },
  C: { label: "C", desc: "professional hearsay", bg: "bg-tier-c", fg: "text-tier-c-foreground" },
  D: { label: "D", desc: "unverified", bg: "bg-tier-d", fg: "text-tier-d-foreground" },
};

export const TIER_BORDER = {
  A: "border-l-tier-a",
  B: "border-l-tier-b",
  C: "border-l-tier-c",
  D: "border-l-tier-d",
};

export const TIER_TOP_BORDER = {
  A: "border-t-tier-a",
  B: "border-t-tier-b",
  C: "border-t-tier-c",
  D: "border-t-tier-d",
};
