-- Kaizen Billing: services per property, ad hoc invoices, products and services, contact checks.
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- ---------------------------------------------------------------------------
-- Products and services (the list chosen from when creating an invoice)
-- ---------------------------------------------------------------------------

create table public.service_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  category text not null default 'other' check (category in ('valet', 'trash_room', 'bulk', 'other')),
  description text,
  -- Default price. Empty means it is typed in each time. Negative for a discount.
  default_rate_cents bigint,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

alter table public.service_items enable row level security;
create policy billing_admin_all on public.service_items for all to authenticated
  using (private.is_billing_admin()) with check (private.is_billing_admin());
revoke all on public.service_items from public, anon, authenticated;
grant select, insert, update, delete on public.service_items to authenticated;
grant all on public.service_items to service_role;
create trigger service_items_audit after insert or update or delete on public.service_items
  for each row execute function private.audit_row();

-- Carried over from the QuickBooks products and services list.
insert into public.service_items (name, category, description, default_rate_cents, sort_order) values
  ('Monthly Valet Waste Service', 'valet', 'Monthly valet trash service', null, 10),
  ('Lease-Up Valet Waste Service', 'valet', 'Discounted rate during the lease-up period', null, 20),
  ('Trash Room Management', 'trash_room', 'Monthly trash room management', null, 30),
  ('Dumpster Management', 'trash_room', 'Monthly dumpster service', null, 40),
  ('Trash Chute Service', 'trash_room', null, null, 50),
  ('Compactor and Waste Management', 'trash_room', 'Ground floor compactor and waste management', null, 60),
  ('Scheduled Bulk Waste Service', 'bulk', 'Scheduled bulk service, per full load', 35000, 70),
  ('Bulk Trash Service', 'bulk', 'Bulk trash removal', null, 80),
  ('Replacement Can', 'other', 'Replacement container', 2500, 90),
  ('Sterilite 1075 Trash Can', 'other', null, 1000, 100),
  ('Resident Satisfaction Discount', 'other', 'Discount', -2500, 110);

-- ---------------------------------------------------------------------------
-- A property can have more than one service, each billed on its own invoice
-- ---------------------------------------------------------------------------

alter table public.contracts
  add column service_category text check (service_category in ('valet', 'trash_room', 'bulk', 'other')),
  -- For services billed from logged work: what a typical month comes to.
  -- Shown on the schedule as an estimate. Never billed.
  add column expected_monthly_cents bigint check (expected_monthly_cents is null or expected_monthly_cents >= 0);

update public.contracts set service_category = case billing_model
  when 'per_unit_valet' then 'valet'
  when 'trash_room' then 'trash_room'
  when 'per_event' then 'bulk'
  when 'as_needed' then 'bulk'
  else 'other' end;
alter table public.contracts alter column service_category set not null;

-- A new contract gets its service from its billing model unless one is given.
create function private.default_service_category() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.service_category is null then
    new.service_category := case new.billing_model
      when 'per_unit_valet' then 'valet'
      when 'trash_room' then 'trash_room'
      when 'per_event' then 'bulk'
      when 'as_needed' then 'bulk'
      else 'other' end;
  end if;
  return new;
end
$$;

create trigger contracts_default_service before insert on public.contracts
  for each row execute function private.default_service_category();

alter table public.invoices
  add column kind text not null default 'scheduled' check (kind in ('scheduled', 'ad_hoc')),
  add column service_category text check (service_category in ('valet', 'trash_room', 'bulk', 'other')),
  add column memo text;

alter table public.invoice_lines add column service_item_id uuid references public.service_items (id);

-- One scheduled invoice per property, per service, per month. Ad hoc invoices are not limited.
drop index public.invoices_one_per_account_month;
create unique index invoices_one_scheduled_per_service_month
  on public.invoices (account_id, service_month, coalesce(service_category, ''))
  where origin = 'app' and status <> 'void' and kind = 'scheduled';

-- The cutover guard protects the monthly schedule. A one-off invoice is a separate job.
create or replace function private.check_invoice_go_live() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_go_live date;
begin
  if new.origin = 'app' and new.kind = 'scheduled' then
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
     kind, service_category, memo)
  values (
    (p ->> 'account_id')::uuid, (p ->> 'service_month')::date, (p ->> 'invoice_date')::date,
    (p ->> 'due_date')::date, 'draft',
    (p ->> 'subtotal_cents')::bigint, (p ->> 'tax_cents')::bigint, (p ->> 'total_cents')::bigint, 'app',
    coalesce(nullif(p ->> 'kind', ''), 'scheduled'), nullif(p ->> 'service_category', ''), nullif(p ->> 'memo', '')
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

-- ---------------------------------------------------------------------------
-- Contact checks: who receives each property's invoices, and when that was last confirmed
-- ---------------------------------------------------------------------------

alter table public.billing_contacts
  add column confirmed_at timestamptz,
  add column confirmed_by uuid,
  add column source text;

-- Several invoices can go out in one email: remember which email each invoice went in.
alter table public.email_sends add column cc text[] not null default '{}';

-- Sending: invoices go out from the invoices address, replies come to Pierce.
alter table public.app_settings add column copy_address text;
update public.app_settings
   set email_sender = coalesce(email_sender, 'Kaizen Waste <invoices@kaizen-waste.com>'),
       email_reply_to = coalesce(email_reply_to, 'pierce@kaizen-waste.com'),
       copy_address = coalesce(copy_address, 'jr@kaizen-waste.com');

commit;
