-- Kaizen Billing: initial schema (Milestone 1).
-- Runs as one transaction: if any statement fails, nothing is created.
-- Money is integer cents (bigint). Percentages are basis points (150 = 1.50%).

begin;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Helper functions used by the access rules
-- ---------------------------------------------------------------------------

-- True when the signed-in user carries the billing_admin tag. The tag lives in
-- app_metadata, which a user cannot change for themselves.
create function private.is_billing_admin() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'billing_admin', false)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  qbo_customer_id text unique,
  is_ach_payer boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.owner_entities (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) > 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  address_line1 text,
  address_line2 text,
  city text,
  state text default 'AZ',
  postal_code text,
  unit_count integer check (unit_count is null or unit_count >= 0),
  wasteos_property_id text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  customer_id uuid not null references public.customers (id),
  owner_entity_id uuid references public.owner_entities (id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  -- First service month this app may invoice. Earlier months belong to QuickBooks.
  go_live_service_month date
    check (go_live_service_month is null or extract(day from go_live_service_month) = 1),
  -- Late fees on invoices imported from QuickBooks are off until Pierce opts in.
  late_fees_on_imported_invoices boolean not null default false,
  collections_notes text,
  last_contact_date date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
-- One active billing account per property (one invoice per property).
create unique index billing_accounts_one_active_per_property
  on public.billing_accounts (property_id) where status = 'active';
create index billing_accounts_customer_idx on public.billing_accounts (customer_id);

-- Which customer a customer-contact login belongs to (used from Milestone 5).
create table public.customer_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  customer_id uuid not null references public.customers (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (user_id, customer_id)
);

create table public.billing_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  name text not null check (length(trim(name)) > 0),
  email text not null check (email like '%_@_%'),
  role text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index billing_contacts_account_idx on public.billing_contacts (account_id);

create table public.account_send_defaults (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.billing_accounts (id),
  recipient_emails text[] not null default '{}',
  send_copy_to_self boolean not null default false,
  send_to_jr boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.late_fee_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  flat_amount_cents bigint not null default 0 check (flat_amount_cents >= 0),
  percent_bps integer not null default 0 check (percent_bps >= 0),
  grace_days integer not null default 0 check (grace_days >= 0),
  frequency text not null default 'one_time' check (frequency in ('one_time', 'recurring')),
  recurrence_interval_days integer check (recurrence_interval_days is null or recurrence_interval_days > 0),
  compounding boolean not null default false,
  cap_cents bigint check (cap_cents is null or cap_cents >= 0),
  -- Set when Pierce confirms the template matches the signed contracts.
  confirmed_at timestamptz,
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (frequency = 'one_time' or recurrence_interval_days is not null)
);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  status text not null default 'draft' check (status in ('draft', 'active', 'ended')),
  billing_model text not null
    check (billing_model in ('per_unit_valet', 'flat_monthly', 'per_event', 'as_needed', 'trash_room')),
  -- Unknown until confirmed against the signed contract; required to activate.
  quoted_basis text check (quoted_basis in ('pre_tax', 'tax_inclusive')),
  net_days integer not null default 30 check (net_days >= 0),
  late_fee_template_id uuid references public.late_fee_templates (id),
  tax_enabled boolean not null default false,
  tax_rate_bps integer not null default 0 check (tax_rate_bps >= 0),
  start_date date,
  end_date date,
  preferred_agreement boolean not null default false,
  rebate_bps integer not null default 0 check (rebate_bps >= 0),
  notion_url text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index contracts_account_idx on public.contracts (account_id);

create table public.contract_phases (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  label text not null check (length(trim(label)) > 0),
  effective_start date not null,
  billable_units integer check (billable_units is null or billable_units >= 0),
  rate_per_unit_cents bigint check (rate_per_unit_cents is null or rate_per_unit_cents >= 0),
  flat_amount_cents bigint check (flat_amount_cents is null or flat_amount_cents >= 0),
  -- A phase that has been invoiced is never changed; it is replaced by a new row.
  superseded_by_phase_id uuid references public.contract_phases (id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (
    (flat_amount_cents is not null and rate_per_unit_cents is null and billable_units is null)
    or (flat_amount_cents is null and rate_per_unit_cents is not null and billable_units is not null)
  )
);
create index contract_phases_contract_idx on public.contract_phases (contract_id, effective_start);

-- Rates for non-recurring work (dumpster moves, bulk pickups, trash room visits by window).
create table public.contract_event_rates (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  event_type text not null
    check (event_type in ('dumpster_move', 'bulk_pickup', 'as_needed', 'trash_room_visit', 'other')),
  time_window text,
  label text,
  rate_cents bigint not null check (rate_cents >= 0),
  effective_start date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index contract_event_rates_contract_idx on public.contract_event_rates (contract_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  -- Assigned on approval; sequential, never reused.
  invoice_number bigint unique,
  service_month date not null check (extract(day from service_month) = 1),
  invoice_date date not null,
  due_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'partially_paid', 'paid', 'void')),
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  origin text not null default 'app' check (origin in ('app', 'quickbooks_import')),
  qbo_invoice_id text unique,
  approved_at timestamptz,
  approved_by uuid,
  sent_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (total_cents = subtotal_cents + tax_cents),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);
-- One live app invoice per account per service month.
create unique index invoices_one_per_account_month
  on public.invoices (account_id, service_month) where origin = 'app' and status <> 'void';
create index invoices_account_idx on public.invoices (account_id);

create table public.billable_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  event_date date not null,
  event_type text not null
    check (event_type in ('dumpster_move', 'bulk_pickup', 'as_needed', 'trash_room_visit', 'other')),
  time_window text,
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  -- Empty when the contract has no rate: the event is then held as an exception.
  rate_cents bigint check (rate_cents is null or rate_cents >= 0),
  description text,
  source_reference text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'invoiced', 'rejected')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index billable_events_account_idx on public.billable_events (account_id, event_date);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id),
  line_type text not null
    check (line_type in ('valet', 'flat', 'per_event', 'late_fee', 'tax', 'adjustment')),
  description text not null,
  quantity numeric(14, 4) not null default 1,
  unit_price_cents bigint not null default 0,
  amount_cents bigint not null,
  contract_phase_id uuid references public.contract_phases (id),
  billable_event_id uuid references public.billable_events (id),
  -- For a late fee line: the invoice the fee relates to.
  related_invoice_id uuid references public.invoices (id),
  period_start date,
  period_end date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index invoice_lines_phase_idx on public.invoice_lines (contract_phase_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  method text not null check (method in ('check', 'ach', 'other')),
  amount_cents bigint not null check (amount_cents > 0),
  received_date date not null,
  deposit_date date,
  check_number text,
  origin text not null default 'app' check (origin in ('app', 'quickbooks_import', 'quickbooks_pull')),
  qbo_payment_id text unique,
  -- Reserved for a future flat-fee ACH provider. Empty for now.
  provider_reference text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index payments_customer_idx on public.payments (customer_id);

create table public.payment_applications (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  invoice_id uuid not null references public.invoices (id),
  account_id uuid not null references public.billing_accounts (id),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index payment_applications_payment_idx on public.payment_applications (payment_id);
create index payment_applications_invoice_idx on public.payment_applications (invoice_id);

create table public.credit_memos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  invoice_id uuid references public.invoices (id),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (length(trim(reason)) > 0),
  memo_date date not null,
  origin text not null default 'app' check (origin in ('app', 'quickbooks_import')),
  qbo_credit_memo_id text unique,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index credit_memos_account_idx on public.credit_memos (account_id);

create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  invoice_id uuid references public.invoices (id),
  -- Signed: positive increases what the customer owes, negative reduces it.
  amount_cents bigint not null check (amount_cents <> 0),
  reason text not null check (length(trim(reason)) > 0),
  adjustment_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index adjustments_account_idx on public.adjustments (account_id);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id),
  account_id uuid not null references public.billing_accounts (id),
  disputed_amount_cents bigint not null check (disputed_amount_cents > 0),
  reason text not null check (length(trim(reason)) > 0),
  opened_date date not null,
  status text not null default 'open' check (status in ('open', 'upheld', 'denied')),
  resolution text,
  resolved_date date,
  credit_memo_id uuid references public.credit_memos (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (status = 'open' or resolved_date is not null)
);
create index disputes_invoice_idx on public.disputes (invoice_id);

-- The ledger. A balance is always the sum of these rows; it is never stored.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  entry_date date not null,
  entry_type text not null
    check (entry_type in ('invoice', 'payment', 'credit', 'late_fee', 'late_fee_waiver', 'adjustment')),
  -- Signed: positive increases what the customer owes, negative reduces it.
  amount_cents bigint not null,
  source_table text not null,
  source_id uuid not null,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index ledger_entries_account_idx on public.ledger_entries (account_id, entry_date, created_at);

create table public.rebate_accruals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  account_id uuid not null references public.billing_accounts (id),
  service_month date not null check (extract(day from service_month) = 1),
  contractual_revenue_cents bigint not null,
  rebate_bps integer not null check (rebate_bps >= 0),
  accrued_cents bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (property_id, service_month)
);

create table public.email_sends (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  invoice_id uuid references public.invoices (id),
  kind text not null check (kind in ('invoice', 'statement')),
  recipients text[] not null,
  subject text,
  sent_at timestamptz not null default now(),
  provider_message_id text,
  delivered_at timestamptz,
  bounced_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index email_sends_account_idx on public.email_sends (account_id);

create table public.qbo_sync_log (
  id uuid primary key default gen_random_uuid(),
  record_table text not null,
  record_id uuid,
  direction text not null check (direction in ('push', 'pull')),
  qbo_id text,
  status text not null check (status in ('ok', 'failed', 'skipped')),
  error_text text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.source_discrepancies (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  field text not null,
  notion_value text,
  spreadsheet_value text,
  quickbooks_value text,
  -- Pierce's decision. Empty until he resolves it.
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- One row only. Bank details are typed here by Pierce in Settings, never in code.
create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  company_name text not null default 'Kaizen Waste, LLC',
  remittance_address text not null default '3459 E Pasadena Ave, Phoenix, AZ 85018',
  ach_instructions text,
  logo_path text,
  default_net_days integer not null default 30 check (default_net_days >= 0),
  email_sender text,
  email_reply_to text,
  -- 1: payments are recorded in QuickBooks and pulled. 2: recorded in this app.
  payments_phase integer not null default 1 check (payments_phase in (1, 2)),
  next_invoice_number bigint,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
insert into public.app_settings default values;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_name text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  record_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

-- ---------------------------------------------------------------------------
-- More helpers (need the tables above)
-- ---------------------------------------------------------------------------

create function private.my_customer_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select customer_id from public.customer_users where user_id = auth.uid()
$$;

create function private.my_account_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select ba.id
  from public.billing_accounts ba
  join public.customer_users cu on cu.customer_id = ba.customer_id
  where cu.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Append-only: the ledger and the audit log reject every change and removal
-- ---------------------------------------------------------------------------

create function private.reject_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: rows cannot be changed or removed.', tg_table_name
    using errcode = 'restrict_violation';
end
$$;

create trigger ledger_entries_no_change before update or delete on public.ledger_entries
  for each row execute function private.reject_change();
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries
  for each statement execute function private.reject_change();
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function private.reject_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.reject_change();

-- ---------------------------------------------------------------------------
-- Business rules enforced by the database
-- ---------------------------------------------------------------------------

-- Hard rule 7: no billing without a confirmed late fee template.
create function private.check_contract_activation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' then
    if new.late_fee_template_id is null or not exists (
      select 1 from public.late_fee_templates t
      where t.id = new.late_fee_template_id and t.confirmed_at is not null
    ) then
      raise exception 'A contract cannot be activated for billing without a confirmed late fee template.'
        using errcode = 'check_violation';
    end if;
    if new.quoted_basis is null then
      raise exception 'Confirm whether the quoted amount is pre-tax or tax-inclusive before activating this contract.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

create trigger contracts_check_activation before insert or update on public.contracts
  for each row execute function private.check_contract_activation();

-- A phase that an invoice has used is history: it can only be marked superseded.
create function private.protect_invoiced_phase() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoice_lines l where l.contract_phase_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'This phase has been invoiced and cannot be removed. Add a new phase instead.'
        using errcode = 'restrict_violation';
    end if;
    if (to_jsonb(new) - 'superseded_at' - 'superseded_by_phase_id')
       is distinct from (to_jsonb(old) - 'superseded_at' - 'superseded_by_phase_id') then
      raise exception 'This phase has been invoiced and cannot be changed. Add a new phase instead.'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger contract_phases_protect before update or delete on public.contract_phases
  for each row execute function private.protect_invoiced_phase();

-- ---------------------------------------------------------------------------
-- Audit log: every insert, change, and removal on every table is recorded
-- ---------------------------------------------------------------------------

create function private.audit_row() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  claims jsonb := auth.jwt();
  before_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  after_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into public.audit_log (actor_id, actor_name, action, table_name, record_id, before, after)
  values (
    auth.uid(),
    coalesce(
      nullif(claims -> 'user_metadata' ->> 'full_name', ''),
      nullif(claims ->> 'email', ''),
      'system'
    ),
    lower(tg_op),
    tg_table_name,
    (coalesce(after_row, before_row) ->> 'id')::uuid,
    before_row,
    after_row
  );
  return null;
end
$$;

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'audit_log'
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
      t || '_audit', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Runs with the permissions of whoever is asking, so the access rules still apply.
create view public.account_overview with (security_invoker = true) as
select
  ba.id as account_id,
  ba.status,
  ba.go_live_service_month,
  p.id as property_id,
  p.name as property_name,
  p.unit_count,
  c.id as customer_id,
  c.name as customer_name,
  coalesce(
    (select sum(le.amount_cents) from public.ledger_entries le where le.account_id = ba.id), 0
  )::bigint as balance_cents,
  (
    select min(i.due_date) from public.invoices i
    where i.account_id = ba.id and i.status in ('sent', 'partially_paid')
  ) as oldest_open_due_date
from public.billing_accounts ba
join public.properties p on p.id = ba.property_id
join public.customers c on c.id = ba.customer_id;

-- ---------------------------------------------------------------------------
-- New Account: one call creates everything, or nothing if any part fails
-- ---------------------------------------------------------------------------

create function public.create_billing_account(p jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_customer_id uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_owner_id uuid := nullif(p ->> 'owner_entity_id', '')::uuid;
  v_property_id uuid;
  v_account_id uuid;
  v_contract_id uuid;
  v_default_net integer;
  c jsonb;
  ph jsonb;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can create an account.' using errcode = 'insufficient_privilege';
  end if;

  if v_customer_id is null then
    insert into public.customers (name) values (p ->> 'customer_name') returning id into v_customer_id;
  end if;

  if v_owner_id is null and nullif(trim(coalesce(p ->> 'owner_legal_name', '')), '') is not null then
    insert into public.owner_entities (legal_name) values (trim(p ->> 'owner_legal_name'))
    returning id into v_owner_id;
  end if;

  insert into public.properties
    (name, address_line1, address_line2, city, state, postal_code, unit_count, wasteos_property_id)
  values (
    p -> 'property' ->> 'name',
    nullif(p -> 'property' ->> 'address_line1', ''),
    nullif(p -> 'property' ->> 'address_line2', ''),
    nullif(p -> 'property' ->> 'city', ''),
    coalesce(nullif(p -> 'property' ->> 'state', ''), 'AZ'),
    nullif(p -> 'property' ->> 'postal_code', ''),
    nullif(p -> 'property' ->> 'unit_count', '')::integer,
    nullif(p -> 'property' ->> 'wasteos_property_id', '')
  ) returning id into v_property_id;

  insert into public.billing_accounts (property_id, customer_id, owner_entity_id)
  values (v_property_id, v_customer_id, v_owner_id)
  returning id into v_account_id;

  for c in select * from jsonb_array_elements(coalesce(p -> 'contacts', '[]'::jsonb)) loop
    insert into public.billing_contacts (account_id, name, email, role)
    values (v_account_id, c ->> 'name', lower(trim(c ->> 'email')), nullif(c ->> 'role', ''));
  end loop;

  select default_net_days into v_default_net from public.app_settings limit 1;

  insert into public.contracts
    (account_id, billing_model, quoted_basis, net_days, start_date, end_date,
     preferred_agreement, rebate_bps, notion_url)
  values (
    v_account_id,
    p -> 'contract' ->> 'billing_model',
    nullif(p -> 'contract' ->> 'quoted_basis', ''),
    coalesce(nullif(p -> 'contract' ->> 'net_days', '')::integer, v_default_net, 30),
    nullif(p -> 'contract' ->> 'start_date', '')::date,
    nullif(p -> 'contract' ->> 'end_date', '')::date,
    coalesce((p -> 'contract' ->> 'preferred_agreement')::boolean, false),
    coalesce(nullif(p -> 'contract' ->> 'rebate_bps', '')::integer, 0),
    nullif(p -> 'contract' ->> 'notion_url', '')
  ) returning id into v_contract_id;

  for ph in select * from jsonb_array_elements(coalesce(p -> 'phases', '[]'::jsonb)) loop
    insert into public.contract_phases
      (contract_id, label, effective_start, billable_units, rate_per_unit_cents, flat_amount_cents)
    values (
      v_contract_id,
      ph ->> 'label',
      (ph ->> 'effective_start')::date,
      nullif(ph ->> 'billable_units', '')::integer,
      nullif(ph ->> 'rate_per_unit_cents', '')::bigint,
      nullif(ph ->> 'flat_amount_cents', '')::bigint
    );
  end loop;

  return v_account_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Permissions and Row Level Security
-- ---------------------------------------------------------------------------

grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;
revoke all on all functions in schema private from public, anon;

revoke all on all tables in schema public from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
-- Belt and braces on top of the triggers above.
revoke update, delete, truncate on public.ledger_entries, public.audit_log from authenticated, service_role;

revoke all on function public.create_billing_account(jsonb) from public, anon;
grant execute on function public.create_billing_account(jsonb) to authenticated, service_role;

-- Anything created later starts locked to signed-out visitors.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy billing_admin_all on public.%I for all to authenticated using (private.is_billing_admin()) with check (private.is_billing_admin())',
      t
    );
  end loop;
end
$$;

-- Customer contacts: read-only, and only rows belonging to their own customer.
create policy customer_read_own on public.customers for select to authenticated
  using (id in (select private.my_customer_ids()));
create policy customer_read_own on public.customer_users for select to authenticated
  using (user_id = auth.uid());
create policy customer_read_own on public.billing_accounts for select to authenticated
  using (id in (select private.my_account_ids()));
create policy customer_read_own on public.properties for select to authenticated
  using (id in (
    select ba.property_id from public.billing_accounts ba
    where ba.id in (select private.my_account_ids())
  ));
-- Customers never see drafts, approved-but-unsent invoices, or voided invoices.
create policy customer_read_own on public.invoices for select to authenticated
  using (
    account_id in (select private.my_account_ids())
    and status in ('sent', 'partially_paid', 'paid')
  );
create policy customer_read_own on public.invoice_lines for select to authenticated
  using (invoice_id in (select i.id from public.invoices i));
create policy customer_read_own on public.payments for select to authenticated
  using (customer_id in (select private.my_customer_ids()));
create policy customer_read_own on public.payment_applications for select to authenticated
  using (account_id in (select private.my_account_ids()));
create policy customer_read_own on public.credit_memos for select to authenticated
  using (account_id in (select private.my_account_ids()));
create policy customer_read_own on public.adjustments for select to authenticated
  using (account_id in (select private.my_account_ids()));
create policy customer_read_own on public.disputes for select to authenticated
  using (account_id in (select private.my_account_ids()));
create policy customer_read_own on public.ledger_entries for select to authenticated
  using (account_id in (select private.my_account_ids()));

grant select on public.account_overview to authenticated, service_role;
revoke all on public.account_overview from anon;

commit;
