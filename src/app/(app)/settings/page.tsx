import { SettingsTabs } from "@/components/section-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Card, inputClass, Notice, PageHeader, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { emailIsConnected } from "@/lib/email/resend";
import { setNextInvoiceNumber } from "../review/actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const { data } = await supabase.from("app_settings").select("*").maybeSingle();
  const connected = emailIsConnected();
  const automated = Boolean(process.env.CRON_SECRET && process.env.SUPABASE_SECRET_KEY);
  const row = (label: string, value: string, good?: boolean) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
      <span className="text-[15px] text-slate-600">{label}</span>
      <span className={`text-[15px] font-medium ${good === undefined ? "text-ink" : good ? "text-emerald-700" : "text-amber-700"}`}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Set once" title="Settings" />
      <SettingsTabs current="general" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Invoice numbering" description="Numbers are assigned when an invoice is approved, in order, and never reused. Start above your highest QuickBooks number so the two never collide.">
          <form action={setNextInvoiceNumber} className="flex flex-wrap gap-2">
            <input name="next_invoice_number" inputMode="numeric" defaultValue={data?.next_invoice_number ?? ""} placeholder="Next invoice number" aria-label="Next invoice number" className={`${inputClass} max-w-52`} />
            <SubmitButton className={secondaryButton}>Save</SubmitButton>
          </form>
          {data?.next_invoice_number == null && <p className="mt-3 text-sm text-amber-700">Not set yet. Nothing can be approved until it is.</p>}
        </Card>

        <Card title="Email">
          {row("Sending", connected ? "Connected" : "Not connected yet", connected)}
          {row("Invoices are sent from", data?.email_sender ?? "Not set")}
          {row("Replies go to", data?.email_reply_to ?? "Not set")}
          {row("Send to JR copies", data?.copy_address ?? "Not set")}
        </Card>

        <Card title="Company on invoices">
          {row("Name", data?.company_name ?? "")}
          {row("Checks mailed to", data?.remittance_address ?? "")}
          {row("Default terms", `Net ${data?.default_net_days ?? 30}`)}
          {row("Late fee", "3% monthly, compounding")}
        </Card>

        <Card title="Automation">
          {row("Monthly drafts", automated ? `Drafted ${data?.draft_days_before ?? 7} days before the 1st` : "Not switched on yet", automated)}
          {row("Payment reminders", "Drafted on the due date, sent when you approve")}
          {row("Emails signed", data?.email_signoff ?? "Kaizen Development Team")}
          <p className="mt-2 text-sm leading-relaxed text-mute">
            Reminders can only be sent automatically once payments are pulled in from QuickBooks. Until then the app cannot tell that a check has arrived, so each reminder waits for you.
          </p>
        </Card>

        <Card title="QuickBooks">
          {row("Connection", "Not connected yet", false)}
          <p className="mt-2 text-sm leading-relaxed text-mute">
            Once connected, each approved invoice is copied into QuickBooks, and payments matched there are pulled back every morning so invoices here show as paid.
          </p>
        </Card>
      </div>
    </div>
  );
}
