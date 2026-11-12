import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerAccount, type CustomerInvoice } from "@/components/customer-account";
import { requireAdmin } from "@/lib/auth";
import { todayInPhoenix } from "@/lib/billing/dates";

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const today = todayInPhoenix();

  const [account, invoices, applications, credits, overview] = await Promise.all([
    supabase.from("billing_accounts").select("id, property:properties(name), customer:customers(name)").eq("id", id).maybeSingle(),
    // A customer only ever sees invoices that have been sent to them.
    supabase.from("invoices").select("*").eq("account_id", id).in("status", ["sent", "partially_paid", "paid"]).order("invoice_date", { ascending: false }),
    supabase.from("payment_applications").select("invoice_id, amount_cents").eq("account_id", id),
    supabase.from("credit_memos").select("invoice_id, amount_cents").eq("account_id", id),
    supabase.from("account_overview").select("balance_cents").eq("account_id", id).maybeSingle(),
  ]);
  if (!account.data) notFound();
  const reduced = new Map<string, number>();
  for (const r of [...(applications.data ?? []), ...(credits.data ?? [])]) {
    if (r.invoice_id) reduced.set(r.invoice_id, (reduced.get(r.invoice_id) ?? 0) + Number(r.amount_cents));
  }
  const list: CustomerInvoice[] = (invoices.data ?? []).map((i) => {
    const remaining = Math.max(0, Number(i.total_cents) - (reduced.get(i.id) ?? 0));
    return {
      id: i.id, number: Number(i.invoice_number), kind: i.kind, serviceCategory: i.service_category, serviceMonth: i.service_month,
      invoiceDate: i.invoice_date, dueDate: i.due_date, totalCents: Number(i.total_cents), remainingCents: remaining, overdue: remaining > 0 && i.due_date < today,
    };
  });
  const property = account.data.property as unknown as { name: string };
  const customer = account.data.customer as unknown as { name: string };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>
          <span className="font-semibold">Preview.</span> This is what {customer.name} will see when they sign in for {property.name}. They cannot change anything, and they never see drafts or invoices that have not been sent.
        </span>
        <Link href={`/accounts/${id}`} className="font-medium underline">Back to the property</Link>
      </div>
      <CustomerAccount
        propertyName={property.name}
        clientName={customer.name}
        balanceCents={Number(overview.data?.balance_cents ?? 0)}
        invoices={list}
        pdfHref={(invoiceId) => `/invoices/${invoiceId}/pdf`}
      />
    </div>
  );
}
