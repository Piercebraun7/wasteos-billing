-- Kaizen Billing: invoicing (Milestone 2).
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- QuickBooks keeps one customer per property, so the link lives on the account.
alter table public.billing_accounts add column qbo_customer_id text unique;

-- The late fee template Pierce confirmed on 2026-11-10: 3% of the unpaid
-- charges, first assessed once the invoice passes its due date (net 30), then
-- every 30 days. Not compounding, no cap.
insert into public.late_fee_templates
  (name, flat_amount_cents, percent_bps, grace_days, frequency, recurrence_interval_days, compounding, cap_cents, confirmed_at)
values ('3% monthly', 0, 300, 0, 'recurring', 30, false, null, now())
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Cutover guard: the app refuses to invoice any month before go-live
-- ---------------------------------------------------------------------------

create function private.check_invoice_go_live() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_go_live date;
begin
  if new.origin = 'app' then
    select go_live_service_month into v_go_live from public.billing_accounts where id = new.account_id;
    if v_go_live is null then
      raise exception 'This account has no go-live service month yet, so the app will not invoice it.'
        using errcode = 'check_violation';
    end if;
    if new.service_month < v_go_live then
      raise exception 'This account goes live with % service. Earlier months were invoiced in QuickBooks.', to_char(v_go_live, 'FMMonth YYYY')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

create trigger invoices_check_go_live before insert on public.invoices
  for each row execute function private.check_invoice_go_live();

-- ---------------------------------------------------------------------------
-- Hard rule 6: a posted invoice is never edited
-- ---------------------------------------------------------------------------

create function private.protect_posted_invoice() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Invoice % has been posted and cannot be deleted. Use a credit memo, an adjustment, or void and reissue.', coalesce(old.invoice_number::text, '')
      using errcode = 'restrict_violation';
  end if;
  -- After posting, only the status and delivery or sync details may change.
  if (to_jsonb(new) - 'status' - 'sent_at' - 'void_reason' - 'qbo_invoice_id')
     is distinct from (to_jsonb(old) - 'status' - 'sent_at' - 'void_reason' - 'qbo_invoice_id') then
    raise exception 'Invoice % has been posted and cannot be edited. Use a credit memo, an adjustment, or void and reissue.', coalesce(old.invoice_number::text, '')
      using errcode = 'restrict_violation';
  end if;
  if new.status = 'draft' then
    raise exception 'A posted invoice cannot go back to draft.' using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;

create trigger invoices_protect_posted before update or delete on public.invoices
  for each row execute function private.protect_posted_invoice();

create function private.protect_posted_lines() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices
  where id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  -- History imported from QuickBooks arrives already posted; its lines may be added once.
  if v_invoice.status <> 'draft'
     and not (tg_op = 'INSERT' and v_invoice.origin = 'quickbooks_import') then
    raise exception 'Invoice % has been posted, so its lines cannot be changed.', coalesce(v_invoice.invoice_number::text, '')
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger invoice_lines_protect_posted before insert or update or delete on public.invoice_lines
  for each row execute function private.protect_posted_lines();

-- ---------------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------------

-- Creates one draft invoice with its lines, or nothing if any part fails.
create function public.create_draft_invoice(p jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  l jsonb;
  n integer := 0;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can create invoices.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.invoices
    (account_id, service_month, invoice_date, due_date, status, subtotal_cents, tax_cents, total_cents, origin)
  values (
    (p ->> 'account_id')::uuid, (p ->> 'service_month')::date, (p ->> 'invoice_date')::date,
    (p ->> 'due_date')::date, 'draft',
    (p ->> 'subtotal_cents')::bigint, (p ->> 'tax_cents')::bigint, (p ->> 'total_cents')::bigint, 'app'
  ) returning id into v_id;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    insert into public.invoice_lines
      (invoice_id, line_type, description, quantity, unit_price_cents, amount_cents,
       contract_phase_id, billable_event_id, period_start, period_end, sort_order)
    values (
      v_id, l ->> 'line_type', l ->> 'description', (l ->> 'quantity')::numeric,
      (l ->> 'unit_price_cents')::bigint, (l ->> 'amount_cents')::bigint,
      nullif(l ->> 'contract_phase_id', '')::uuid, nullif(l ->> 'billable_event_id', '')::uuid,
      nullif(l ->> 'period_start', '')::date, nullif(l ->> 'period_end', '')::date, n
    );
    n := n + 1;
  end loop;
  return v_id;
end
$$;

-- Brings a draft's totals back in line with its lines after an edit.
create function public.recalculate_draft(p_invoice_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_subtotal bigint;
  v_tax bigint;
begin
  select coalesce(sum(amount_cents) filter (where line_type <> 'tax'), 0),
         coalesce(sum(amount_cents) filter (where line_type = 'tax'), 0)
    into v_subtotal, v_tax
  from public.invoice_lines where invoice_id = p_invoice_id;
  update public.invoices
     set subtotal_cents = v_subtotal, tax_cents = v_tax, total_cents = v_subtotal + v_tax
   where id = p_invoice_id and status = 'draft';
  if not found then
    raise exception 'Only a draft can be edited.' using errcode = 'restrict_violation';
  end if;
end
$$;

-- Rejecting a draft removes it. No invoice number was ever assigned, so none is wasted.
create function public.reject_draft(p_invoice_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.invoices where id = p_invoice_id and status = 'draft') then
    raise exception 'Only a draft can be rejected.' using errcode = 'restrict_violation';
  end if;
  delete from public.invoice_lines where invoice_id = p_invoice_id;
  delete from public.invoices where id = p_invoice_id;
end
$$;

-- Approval: assigns the next number, posts the invoice to the ledger, and
-- locks it. All in one step, so an invoice is never half approved.
create function public.approve_invoice(p_invoice_id uuid) returns bigint
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

  select next_invoice_number into v_number from public.app_settings for update;
  if v_number is null then
    raise exception 'Set the next invoice number before approving the first invoice.' using errcode = 'check_violation';
  end if;
  -- Never reuse a number, including numbers imported from QuickBooks.
  while exists (select 1 from public.invoices where invoice_number = v_number) loop
    v_number := v_number + 1;
  end loop;
  update public.app_settings set next_invoice_number = v_number + 1;

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

revoke all on function public.create_draft_invoice(jsonb), public.recalculate_draft(uuid),
  public.reject_draft(uuid), public.approve_invoice(uuid) from public, anon;
grant execute on function public.create_draft_invoice(jsonb), public.recalculate_draft(uuid),
  public.reject_draft(uuid), public.approve_invoice(uuid) to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private storage for invoice PDFs (served only through short-lived signed links)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
    on conflict (id) do nothing;
    execute $p$create policy billing_admin_invoice_files on storage.objects for all to authenticated
      using (bucket_id = 'invoices' and private.is_billing_admin())
      with check (bucket_id = 'invoices' and private.is_billing_admin())$p$;
  end if;
end
$$;

commit;
