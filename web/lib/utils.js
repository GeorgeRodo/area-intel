import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names, letting later Tailwind utilities win over
 * earlier ones in the same group. Every component in components/ui takes a
 * `className` and runs it through here, so a call site can override a default
 * (`p-4` over the built-in `p-6`) without fighting specificity.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
