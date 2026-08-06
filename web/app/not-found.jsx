import Link from "next/link";
import { Compass } from "lucide-react";

export const metadata = { title: "Not found" };

/**
 * A server component, so it renders its own markup rather than passing the
 * icon component into <EmptyState/>: a function prop cannot cross the
 * server/client boundary.
 */
export default function NotFound() {
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg border bg-muted/40">
        <Compass className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h1 className="text-sm font-medium">No such page.</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        The link may be stale — the review queue and mission control moved into
        the admin panel.
      </p>
      <p className="mt-4">
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          Back to the start
        </Link>
      </p>
    </div>
  );
}
