-- Kaizen Billing: recurring invoices (for example bulk trash once a month).
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- A saved invoice that repeats every month on a chosen day. It appears on the
-- schedule of billing, and a draft is made from it each month for review.
create table public.recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  name text not null check (length(trim(name)) > 0),
  service_category text not null default 'bulk' check (service_category in ('valet', 'trash_room', 'bulk', 'other')),
  day_of_month integer not null check (day_of_month between 1 and 28),
  start_month date not null check (extract(day from start_month) = 1),
  net_days integer not null default 30 check (net_days >= 0),
  memo text,
  -- [{ "service_item_id": "...", "description": "...", "quantity": "1", "unit_price_cents": 35000 }]
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index recurring_invoices_account_idx on public.recurring_invoices (account_id);

alter table public.recurring_invoices enable row level security;
create policy billing_admin_all on public.recurring_invoices for all to authenticated
  using (private.is_billing_admin()) with check (private.is_billing_admin());
revoke all on public.recurring_invoices from public, anon, authenticated;
grant select, insert, update, delete on public.recurring_invoices to authenticated;
grant all on public.recurring_invoices to service_role;
create trigger recurring_invoices_audit after insert or update or delete on public.recurring_invoices
  for each row execute function private.audit_row();

-- Each recurring invoice produces at most one invoice per month.
alter table public.invoices add column recurring_invoice_id uuid references public.recurring_invoices (id);
create unique index invoices_one_per_recurring_month
  on public.invoices (recurring_invoice_id, service_month)
  where recurring_invoice_id is not null and status <> 'void';

create or replace function public.create_draft_invoice(p jsonb) returns uuid
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
    (account_id, service_month, invoice_date, due_date, status, subtotal_cents, tax_cents, total_cents, origin,
     kind, service_category, memo, recurring_invoice_id)
  values (
    (p ->> 'account_id')::uuid, (p ->> 'service_month')::date, (p ->> 'invoice_date')::date,
    (p ->> 'due_date')::date, 'draft',
    (p ->> 'subtotal_cents')::bigint, (p ->> 'tax_cents')::bigint, (p ->> 'total_cents')::bigint, 'app',
    coalesce(nullif(p ->> 'kind', ''), 'scheduled'), nullif(p ->> 'service_category', ''), nullif(p ->> 'memo', ''),
    nullif(p ->> 'recurring_invoice_id', '')::uuid
  ) returning id into v_id;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    insert into public.invoice_lines
      (invoice_id, line_type, description, quantity, unit_price_cents, amount_cents,
       contract_phase_id, billable_event_id, service_item_id, period_start, period_end, sort_order)
    values (
      v_id, l ->> 'line_type', l ->> 'description', (l ->> 'quantity')::numeric,
      (l ->> 'unit_price_cents')::bigint, (l ->> 'amount_cents')::bigint,
      nullif(l ->> 'contract_phase_id', '')::uuid, nullif(l ->> 'billable_event_id', '')::uuid,
      nullif(l ->> 'service_item_id', '')::uuid,
      nullif(l ->> 'period_start', '')::date, nullif(l ->> 'period_end', '')::date, n
    );
    n := n + 1;
  end loop;
  return v_id;
end
$$;

-- Removing a property also removes its recurring invoices (when it has no history).
create or replace function public.delete_billing_account(p_account_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_property uuid;
  v_customer uuid;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can remove a property.' using errcode = 'insufficient_privilege';
  end if;
  select property_id, customer_id into v_property, v_customer from public.billing_accounts where id = p_account_id;
  if not found then
    raise exception 'Property not found.' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.invoices where account_id = p_account_id and status <> 'draft')
     or exists (select 1 from public.ledger_entries where account_id = p_account_id)
     or exists (select 1 from public.payment_applications where account_id = p_account_id)
     or exists (select 1 from public.credit_memos where account_id = p_account_id)
     or exists (select 1 from public.adjustments where account_id = p_account_id)
     or exists (select 1 from public.email_sends where account_id = p_account_id) then
    update public.contracts set status = 'ended' where account_id = p_account_id and status <> 'ended';
    update public.recurring_invoices set status = 'paused' where account_id = p_account_id;
    update public.billing_accounts set status = 'inactive' where id = p_account_id;
    return 'archived';
  end if;

  delete from public.invoice_lines where invoice_id in (select id from public.invoices where account_id = p_account_id);
  delete from public.invoices where account_id = p_account_id;
  delete from public.recurring_invoices where account_id = p_account_id;
  delete from public.billable_events where account_id = p_account_id;
  delete from public.contract_event_rates where contract_id in (select id from public.contracts where account_id = p_account_id);
  delete from public.contract_phases where contract_id in (select id from public.contracts where account_id = p_account_id);
  delete from public.contracts where account_id = p_account_id;
  delete from public.billing_contacts where account_id = p_account_id;
  delete from public.account_send_defaults where account_id = p_account_id;
  delete from public.rebate_accruals where account_id = p_account_id;
  delete from public.billing_accounts where id = p_account_id;

  if not exists (select 1 from public.billing_accounts where property_id = v_property) then
    delete from public.source_discrepancies where property_id = v_property;
    delete from public.properties where id = v_property;
  end if;
  if not exists (select 1 from public.billing_accounts where customer_id = v_customer)
     and not exists (select 1 from public.payments where customer_id = v_customer)
     and not exists (select 1 from public.customer_users where customer_id = v_customer) then
    delete from public.customers where id = v_customer;
  end if;
  return 'deleted';
end
$$;

commit;
