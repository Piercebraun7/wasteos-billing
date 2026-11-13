-- Opening balances. The app reads the invoices still open in QuickBooks and
-- brings each one in as it stands there: same number, dates, lines (including
-- late fees QuickBooks already added) and amount still open. The amounts come
-- straight from QuickBooks at the moment of the import and are never written
-- into the code. Nothing is created or changed in QuickBooks.

-- Brings in one open QuickBooks invoice. Safe to repeat: an invoice number
-- that is already here is left alone, and an account that is not active is
-- skipped. Returns true when a row was added.
create function public.import_qbo_open_invoice(p jsonb) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_account uuid;
  v_customer uuid;
  v_id uuid;
  v_number bigint := (p ->> 'number')::bigint;
  v_total bigint := (p ->> 'total_cents')::bigint;
  v_open bigint := (p ->> 'open_cents')::bigint;
  v_date date := (p ->> 'invoice_date')::date;
  v_payment uuid;
  l jsonb;
  i integer := 0;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can bring in invoices.' using errcode = 'insufficient_privilege';
  end if;
  select a.id, a.customer_id into v_account, v_customer
  from public.billing_accounts a
  where a.id = (p ->> 'account_id')::uuid and a.status = 'active';
  if v_account is null then return false; end if;
  if exists (select 1 from public.invoices where invoice_number = v_number) then return false; end if;
  if v_open <= 0 or v_open > v_total then
    raise exception 'Invoice %: the open amount must be between a cent and the total.', v_number;
  end if;

  -- Lines can only be added while the invoice is a draft, so it starts as one.
  insert into public.invoices (account_id, service_month, invoice_date, due_date, status, subtotal_cents, tax_cents, total_cents,
                               origin, kind, service_category, memo)
  values (v_account, date_trunc('month', v_date)::date, v_date, (p ->> 'due_date')::date, 'draft', v_total, 0, v_total,
          'quickbooks_import', 'ad_hoc', p ->> 'service', 'Brought in from QuickBooks.')
  returning id into v_id;

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    insert into public.invoice_lines (invoice_id, line_type, description, quantity, unit_price_cents, amount_cents, sort_order)
    values (v_id, l ->> 'line_type', l ->> 'description', (l ->> 'quantity')::numeric, (l ->> 'unit_price_cents')::bigint, (l ->> 'amount_cents')::bigint, i);
    i := i + 1;
  end loop;
  if (select coalesce(sum(amount_cents), 0) from public.invoice_lines where invoice_id = v_id) <> v_total then
    raise exception 'Invoice %: the lines do not add up to the total.', v_number;
  end if;

  update public.invoices
     set status = case when v_open < v_total then 'partially_paid' else 'sent' end,
         invoice_number = v_number, qbo_invoice_id = p ->> 'qbo_id', sent_at = v_date::timestamptz
   where id = v_id;

  insert into public.ledger_entries (account_id, entry_date, entry_type, amount_cents, source_table, source_id, description)
  values (v_account, v_date, 'invoice', v_total, 'invoices', v_id, 'Invoice ' || v_number || ' (from QuickBooks)');

  -- What QuickBooks already shows as paid on this invoice.
  if v_open < v_total then
    insert into public.payments (customer_id, method, amount_cents, received_date, origin)
    values (v_customer, 'other', v_total - v_open, v_date, 'quickbooks_import') returning id into v_payment;
    insert into public.payment_applications (payment_id, invoice_id, account_id, amount_cents)
    values (v_payment, v_id, v_account, v_total - v_open);
    insert into public.ledger_entries (account_id, entry_date, entry_type, amount_cents, source_table, source_id, description)
    values (v_account, v_date, 'payment', -(v_total - v_open), 'payments', v_payment, 'Paid in QuickBooks on invoice ' || v_number);
  end if;

  return true;
end
$$;
revoke all on function public.import_qbo_open_invoice(jsonb) from public, anon;
grant execute on function public.import_qbo_open_invoice(jsonb) to authenticated, service_role;

