"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

/**
 * Last line of defence: a render that throws anywhere under "/" lands here
 * instead of blanking the app. Data-fetch failures are handled inline by each
 * panel; this is for the ones nobody predicted.
 */
export default function AppError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something broke on this page."
      action={<Button onClick={reset}>Try again</Button>}
    >
      {error?.digest ? `Reference ${error.digest}.` : null} The rest of the app is
      still usable — the error was contained to this view.
    </EmptyState>
  );
}
