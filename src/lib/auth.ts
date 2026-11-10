import { redirect } from "next/navigation";
import { createClient, isBillingAdmin } from "@/lib/supabase/server";

/** For pages and actions that only Pierce and JR may use. */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isBillingAdmin(user)) redirect("/no-access");
  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";
  return { supabase, user, name };
}
