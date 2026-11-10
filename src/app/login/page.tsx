import { redirect } from "next/navigation";
import { createClient, isBillingAdmin } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const instant = false;

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (isBillingAdmin(user)) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#FF4B37]">
          Kaizen Waste
        </p>
        <h1 className="mt-1 mb-6 text-2xl font-bold text-slate-900">
          Billing sign in
        </h1>
        <LoginForm />
      </div>
    </main>
  );
}
