import { Notice, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { ItemsList, type Item } from "./items-list";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const { data } = await supabase.from("service_items").select("*").order("sort_order").order("name");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Products and services"
        description="What you can put on an invoice. Click anything to change it."
      />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <ItemsList items={(data ?? []) as Item[]} />
    </div>
  );
}
