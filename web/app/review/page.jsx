import { redirect } from "next/navigation";

// The review queue now lives inside the admin panel at "/?tab=queue".
// Non-admins land on "/" too, which renders the coverage areas for them.
// Redirecting on the server avoids rendering an empty client page first.
export default function ReviewRedirect() {
  redirect("/?tab=queue");
}
