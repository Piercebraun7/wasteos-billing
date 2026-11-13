-- Payments are recorded in QuickBooks (it sees the bank account). Once a day
-- the app asks QuickBooks how much has been paid on each invoice and records
-- the difference here, linked to that invoice. The amount passed in is the
-- total QuickBooks shows as paid on the invoice, so repeating the call with
-- the same figure changes nothing.
create function public.record_qbo_paid(p_invoice_id uuid, p_paid_total_cents bigint, p_date date, p_reference text, p_qbo_payment_id text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_customer uuid;
  v_recorded bigint;
  v_credited bigint;
  v_new bigint;
  v_payment uuid;
  v_qbo_id text := nullif(trim(coalesce(p_qbo_payment_id, '')), '');
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can record payments.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'no_data_found';
  end if;
  if v_invoice.status not in ('approved', 'sent', 'partially_paid') then return 0; end if;

  select coalesce(sum(amount_cents), 0) into v_recorded from public.payment_applications where invoice_id = v_invoice.id;
  select coalesce(sum(amount_cents), 0) into v_credited from public.credit_memos where invoice_id = v_invoice.id;
  -- Never record more than is still open here, even if QuickBooks shows more (a late fee it added, for example).
  v_new := least(p_paid_total_cents - v_recorded, v_invoice.total_cents - v_recorded - v_credited);
  if v_new <= 0 then return 0; end if;

  select customer_id into v_customer from public.billing_accounts where id = v_invoice.account_id;
  -- One QuickBooks payment can cover several invoices; it is stored once per invoice it pays.
  if v_qbo_id is not null and exists (select 1 from public.payments where qbo_payment_id = v_qbo_id) then
    v_qbo_id := v_qbo_id || ':' || v_invoice.invoice_number;
    if exists (select 1 from public.payments where qbo_payment_id = v_qbo_id) then v_qbo_id := null; end if;
  end if;
  insert into public.payments (customer_id, method, amount_cents, received_date, check_number, origin, qbo_payment_id)
  values (v_customer, case when nullif(trim(coalesce(p_reference, '')), '') is null then 'other' else 'check' end,
          v_new, p_date, nullif(trim(coalesce(p_reference, '')), ''), 'quickbooks_pull', v_qbo_id)
  returning id into v_payment;
  insert into public.payment_applications (payment_id, invoice_id, account_id, amount_cents)
  values (v_payment, v_invoice.id, v_invoice.account_id, v_new);
  insert into public.ledger_entries (account_id, entry_date, entry_type, amount_cents, source_table, source_id, description)
  values (v_invoice.account_id, p_date, 'payment', -v_new, 'payments', v_payment,
          'Payment on invoice ' || v_invoice.invoice_number || ' (recorded in QuickBooks)');

  update public.invoices
     set status = case when v_recorded + v_credited + v_new >= v_invoice.total_cents then 'paid' else 'partially_paid' end
   where id = v_invoice.id;
  return v_new;
end
$$;
revoke all on function public.record_qbo_paid(uuid, bigint, date, text, text) from public, anon;
grant execute on function public.record_qbo_paid(uuid, bigint, date, text, text) to authenticated, service_role;

alter table public.qbo_connection add column last_synced_at timestamptz;
alter table public.qbo_connection add column last_sync_note text;
