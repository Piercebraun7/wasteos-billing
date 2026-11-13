-- The live database refuses any UPDATE without a WHERE clause when it comes
-- through the app (a safety setting). Approving an invoice bumped the next
-- invoice number without one, so approval failed. Same function, with the filter.
create or replace function public.approve_invoice(p_invoice_id uuid) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_number bigint;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can approve invoices.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'no_data_found';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Only a draft can be approved.' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = v_invoice.id) then
    raise exception 'This draft has no lines, so there is nothing to approve.' using errcode = 'check_violation';
  end if;

  select next_invoice_number into v_number from public.app_settings where singleton for update;
  if v_number is null then
    raise exception 'Set the next invoice number before approving the first invoice.' using errcode = 'check_violation';
  end if;
  -- Never reuse a number, including numbers imported from QuickBooks.
  while exists (select 1 from public.invoices where invoice_number = v_number) loop
    v_number := v_number + 1;
  end loop;
  update public.app_settings set next_invoice_number = v_number + 1 where singleton;

  update public.invoices
     set status = 'approved', invoice_number = v_number, approved_at = now(), approved_by = auth.uid()
   where id = v_invoice.id;

  insert into public.ledger_entries (account_id, entry_date, entry_type, amount_cents, source_table, source_id, description)
  values (v_invoice.account_id, v_invoice.invoice_date, 'invoice', v_invoice.total_cents, 'invoices', v_invoice.id,
          'Invoice ' || v_number);

  update public.billable_events set status = 'invoiced'
   where id in (select billable_event_id from public.invoice_lines
                where invoice_id = v_invoice.id and billable_event_id is not null);

  return v_number;
end
$$;
