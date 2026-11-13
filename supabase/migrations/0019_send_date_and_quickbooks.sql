-- 1. Monthly invoices are dated the day they are approved to go out, and are
--    due that date plus the contract's net days. One-off invoices keep the
--    date typed on them (bulk pickups stay dated the day of the pickup).
create or replace function public.approve_invoice(p_invoice_id uuid) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_number bigint;
  v_today date := (now() at time zone 'America/Phoenix')::date;
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

  if v_invoice.kind = 'scheduled' then
    v_invoice.due_date := v_today + (v_invoice.due_date - v_invoice.invoice_date);
    v_invoice.invoice_date := v_today;
  end if;

  update public.invoices
     set status = 'approved', invoice_number = v_number, approved_at = now(), approved_by = auth.uid(),
         invoice_date = v_invoice.invoice_date, due_date = v_invoice.due_date
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


-- 2. The QuickBooks connection. One row: which company is connected and the
--    tokens that keep it connected. Only billing admins can read it.
create table public.qbo_connection (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  realm_id text not null,
  company_name text,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  -- Which QuickBooks product each kind of service posts to: {"valet": "12", ...}
  item_map jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.qbo_connection enable row level security;
create policy billing_admin_all on public.qbo_connection for all to authenticated
  using (private.is_billing_admin()) with check (private.is_billing_admin());
revoke all on public.qbo_connection from public, anon, authenticated;
grant select, insert, update, delete on public.qbo_connection to authenticated;
grant all on public.qbo_connection to service_role;
-- Deliberately no audit trigger: the audit log must never hold a copy of the tokens.
