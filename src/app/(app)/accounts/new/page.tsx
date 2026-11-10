import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { NewAccountForm } from "./new-account-form";

export default async function NewAccountPage() {
  const { supabase } = await requireAdmin();
  const [customers, owners, settings] = await Promise.all([
    supabase.from("customers").select("id, name").order("name"),
    supabase.from("owner_entities").select("id, legal_name").order("legal_name"),
    supabase.from("app_settings").select("default_net_days").maybeSingle(),
  ]);

  return (
    <>
      <Link href="/accounts" className="inline-flex items-center gap-1.5 text-sm font-medium text-mute transition hover:text-ink">
        <span aria-hidden>&larr;</span> Clients
      </Link>
      <div className="mt-4">
        <PageHeader
          eyebrow="Receivables"
          title="New Property"
          description="Fields marked with a red asterisk are required. Everything can be edited later."
        />
      </div>
      <NewAccountForm
        customers={(customers.data ?? []) as { id: string; name: string }[]}
        owners={(owners.data ?? []) as { id: string; legal_name: string }[]}
        defaultNetDays={settings.data?.default_net_days ?? 30}
      />
    </>
  );
}
