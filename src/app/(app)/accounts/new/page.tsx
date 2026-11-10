import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { NewAccountForm } from "./new-account-form";

export const instant = false;

export default async function NewAccountPage() {
  const { supabase } = await requireAdmin();
  const [customers, owners, settings] = await Promise.all([
    supabase.from("customers").select("id, name").order("name"),
    supabase.from("owner_entities").select("id, legal_name").order("legal_name"),
    supabase.from("app_settings").select("default_net_days").maybeSingle(),
  ]);

  return (
    <>
      <Link href="/accounts" className="text-sm text-slate-600 hover:text-black">Back to Accounts</Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">New Account</h1>
      <p className="mt-1 text-slate-600">
        Only the property name, the customer, and the billing model are required. Everything can be edited later.
      </p>
      <NewAccountForm
        customers={(customers.data ?? []) as { id: string; name: string }[]}
        owners={(owners.data ?? []) as { id: string; legal_name: string }[]}
        defaultNetDays={settings.data?.default_net_days ?? 30}
      />
    </>
  );
}
