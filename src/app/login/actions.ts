"use server";

import { redirect } from "next/navigation";
import { createClient, isBillingAdmin } from "@/lib/supabase/server";

export type SignInState = { error: string } | undefined;

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    return { error: "That email and password did not match. Try again." };
  }
  if (!isBillingAdmin(data.user)) {
    await supabase.auth.signOut();
    return { error: "This account does not have access to Kaizen Billing." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
