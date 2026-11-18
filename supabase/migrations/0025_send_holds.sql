-- An approved invoice can be held back from sending. It stays approved and
-- on the account; it is simply left out of Send until someone puts it back.
create table public.send_holds (
  invoice_id uuid primary key references public.invoices (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.send_holds enable row level security;
create policy billing_admin_all on public.send_holds for all to authenticated
  using (private.is_billing_admin()) with check (private.is_billing_admin());
revoke all on public.send_holds from public, anon, authenticated;
grant select, insert, delete on public.send_holds to authenticated;
grant all on public.send_holds to service_role;
create trigger send_holds_audit after insert or update or delete on public.send_holds
  for each row execute function private.audit_row();
