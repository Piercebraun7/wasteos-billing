import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient, currentUser, isBillingAdmin } from "@/lib/supabase/server";

/**
 * For pages and actions that only Pierce and JR may use. Worked out once per
 * request, however many parts of the page ask.
 */
export const requireAdmin = cache(async () => {
  const supabase = await createClient();
  const user = await currentUser(supabase);
  if (!user) redirect("/login");
  if (!isBillingAdmin(user)) redirect("/no-access");
  const name = (user.user_metadata.full_name as string | undefined) ?? user.email ?? "";
  return { supabase, user, name };
});
