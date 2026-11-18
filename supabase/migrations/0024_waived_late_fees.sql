-- Rejecting a late fee draft waives that fee for good. Without a record of
-- it, the daily check would simply draft the same fee again the next day.
create table public.late_fee_waivers (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id),
  period integer not null check (period >= 1),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (invoice_id, period)
);
alter table public.late_fee_waivers enable row level security;
create policy billing_admin_all on public.late_fee_waivers for all to authenticated
  using (private.is_billing_admin()) with check (private.is_billing_admin());
revoke all on public.late_fee_waivers from public, anon, authenticated;
grant select, insert on public.late_fee_waivers to authenticated;
grant all on public.late_fee_waivers to service_role;
create trigger late_fee_waivers_audit after insert or update or delete on public.late_fee_waivers
  for each row execute function private.audit_row();

-- Rejecting a draft removes it. No invoice number was ever assigned, so none is wasted.
-- If the draft was a late fee, the fee is recorded as waived first.
create or replace function public.reject_draft(p_invoice_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id and status = 'draft';
  if not found then
    raise exception 'Only a draft can be rejected.' using errcode = 'restrict_violation';
  end if;
  if v_invoice.late_fee_for is not null then
    insert into public.late_fee_waivers (invoice_id, period) values (v_invoice.late_fee_for, v_invoice.late_fee_period)
    on conflict (invoice_id, period) do nothing;
  end if;
  delete from public.invoice_lines where invoice_id = p_invoice_id;
  delete from public.invoices where id = p_invoice_id;
end
$$;
