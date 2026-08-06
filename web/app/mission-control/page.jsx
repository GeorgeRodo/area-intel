import { redirect } from "next/navigation";

// Mission Control now lives inside the admin panel at "/".
export default function MissionControlRedirect() {
  redirect("/");
}
