import { redirect } from "next/navigation";
import { getCurrentUser } from "./auth";

/** Use at the top of every protected page. Returns the user or redirects. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
