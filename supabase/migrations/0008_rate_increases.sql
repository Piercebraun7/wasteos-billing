-- Kaizen Billing: annual rate increases.
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- Each contract's standard annual increase, how much notice it requires, and any cap.
alter table public.contracts
  add column escalation_bps integer not null default 300 check (escalation_bps >= 0),
  add column rate_notice_days integer not null default 90 check (rate_notice_days > 0),
  add column escalation_cap_bps integer check (escalation_cap_bps is null or escalation_cap_bps >= 0);

-- A decision about one year's increase. With no row, the increase is only
-- planned: it shows on the schedule but is not billed until confirmed here.
create table public.rate_increases (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  effective_month date not null check (extract(day from effective_month) = 1),
  percent_bps integer not null check (percent_bps >= 0),
  status text not null check (status in ('confirmed', 'skipped')),
  notice_sent_at timestamptz,
  notice_note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (contract_id, effective_month)
);

alter table public.rate_increases enable row level security;
create policy billing_admin_all on public.rate_increases for all to authenticated
  using (private.is_billing_admin()) with check (private.is_billing_admin());
revoke all on public.rate_increases from public, anon, authenticated;
grant select, insert, update, delete on public.rate_increases to authenticated;
grant all on public.rate_increases to service_role;
create trigger rate_increases_audit after insert or update or delete on public.rate_increases
  for each row execute function private.audit_row();

-- Rate increase notices are logged with the other emails.
alter table public.email_sends drop constraint email_sends_kind_check;
alter table public.email_sends add constraint email_sends_kind_check check (kind in ('invoice', 'statement', 'notice'));

-- What the signed contracts say. Six require 30 days' notice; the rest say 3 months.
update public.contracts c set rate_notice_days = 30
  from public.billing_accounts a join public.properties p on p.id = a.property_id
 where a.id = c.account_id
   and p.name in ('Ascend at Black Canyon', 'Village at Borgata', 'ELUX at McQueen', 'Jefferson Drove', 'ONE Camelback', 'Terra');

update public.contracts c set escalation_cap_bps = v.cap
  from public.billing_accounts a join public.properties p on p.id = a.property_id,
       (values ('Ascend at Black Canyon', 300), ('Bungalows on Sarival', 300), ('Jefferson Drove', 300), ('Terra', 300), ('ELUX at McQueen', 500)) as v(name, cap)
 where a.id = c.account_id and p.name = v.name;

-- Village at Skyline Ranch is 167 units at $12.50. The $2,254.50 loaded earlier
-- was the contract's tax-inclusive total. Corrected only if it has not been invoiced.
update public.contract_phases ph
   set flat_amount_cents = null, billable_units = 167, rate_per_unit_cents = 1250
  from public.contracts c join public.billing_accounts a on a.id = c.account_id join public.properties p on p.id = a.property_id
 where c.id = ph.contract_id and p.name = 'Village at Skyline Ranch' and ph.flat_amount_cents = 225450
   and not exists (select 1 from public.invoice_lines l where l.contract_phase_id = ph.id);

commit;
