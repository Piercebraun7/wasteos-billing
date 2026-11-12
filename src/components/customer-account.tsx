import { monthLabel } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { isServiceCategory, SERVICES } from "@/lib/services";

export type CustomerInvoice = {
  id: string;
  number: number;
  kind: string;
  serviceCategory: string | null;
  serviceMonth: string;
  invoiceDate: string;
  dueDate: string;
  totalCents: number;
  remainingCents: number;
  overdue: boolean;
};

/**
 * What a customer sees for one property: what they owe, their open invoices,
 * and what they have paid. Read-only. The same view is used for the admin
 * preview and for the customer's own sign-in.
 */
export function CustomerAccount({
  propertyName,
  clientName,
  balanceCents,
  invoices,
  pdfHref,
}: {
  propertyName: string;
  clientName: string;
  balanceCents: number;
  invoices: CustomerInvoice[];
  pdfHref: (invoiceId: string) => string;
}) {
  const open = invoices.filter((i) => i.remainingCents > 0);
  const paid = invoices.filter((i) => i.remainingCents === 0);
  const overdue = open.filter((i) => i.overdue).reduce((sum, i) => sum + i.remainingCents, 0);
  const row = (i: CustomerInvoice) => {
    const service = SERVICES[isServiceCategory(i.serviceCategory) ? i.serviceCategory : "other"];
    return (
      <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[6rem_minmax(0,1fr)_8rem_8rem_auto]">
        <span className="hidden font-semibold tabular-nums text-ink sm:block">No. {i.number}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">
            <span className="sm:hidden">No. {i.number} · </span>
            {service.label}, {i.kind === "ad_hoc" ? formatDate(i.invoiceDate) : monthLabel(i.serviceMonth)}
          </span>
          <span className={`block text-sm ${i.overdue ? "font-medium text-red-600" : "text-mute"}`}>
            {i.remainingCents === 0 ? "Paid" : i.overdue ? `Was due ${formatDate(i.dueDate)}` : `Due ${formatDate(i.dueDate)}`}
          </span>
        </span>
        <span className="hidden text-right tabular-nums text-slate-600 sm:block">{formatCents(i.totalCents)}</span>
        <span className="text-right text-[17px] font-semibold tabular-nums text-ink">{formatCents(i.remainingCents)}</span>
        <a href={pdfHref(i.id)} target="_blank" rel="noreferrer" className="hidden rounded-full border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50 sm:block">
          PDF
        </a>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] bg-ink p-6 text-white sm:p-9">
        <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/50">Your account with Kaizen Waste</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{propertyName}</h1>
            <p className="mt-1 text-[15px] text-white/60">{clientName}</p>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/50">Total amount due</p>
            <p className="font-display mt-2 text-5xl font-extrabold tabular-nums sm:text-6xl">{formatCents(balanceCents)}</p>
            {overdue > 0 && <p className="mt-1 text-sm font-medium text-red-300">{formatCents(overdue)} is past due</p>}
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mute">Open invoices</h2>
        {open.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center text-mute">Nothing is owed. Thank you.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white">{open.map(row)}</ul>
        )}
      </section>

      {paid.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mute">Paid</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white">{paid.map(row)}</ul>
        </section>
      )}

      <p className="text-sm text-mute">
        Checks can be mailed to Kaizen Waste, LLC, 3459 E Pasadena Ave, Phoenix, AZ 85018. Questions about an invoice: reply to the email it came with.
      </p>
    </div>
  );
}
