-- Invoice templates: which blocks print on an invoice. One template is the
-- default for every property; any property can be given a different one.
-- A posted invoice keeps the PDF made when it was approved, so changing a
-- template only affects invoices approved afterwards.
create table public.invoice_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  is_default boolean not null default false,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index invoice_templates_one_default on public.invoice_templates (is_default) where is_default;
create unique index invoice_templates_name on public.invoice_templates (lower(name));

alter table public.invoice_templates enable row level security;
create policy billing_admin_all on public.invoice_templates for all to authenticated
  using (private.is_billing_admin()) with check (private.is_billing_admin());
revoke all on public.invoice_templates from public, anon, authenticated;
grant select, insert, update, delete on public.invoice_templates to authenticated;
grant all on public.invoice_templates to service_role;
create trigger invoice_templates_audit after insert or update or delete on public.invoice_templates
  for each row execute function private.audit_row();

insert into public.invoice_templates (name, is_default) values ('Standard', true);

alter table public.billing_accounts add column invoice_template_id uuid references public.invoice_templates (id) on delete set null;
-- The customer's own account, vendor or purchase order number for Kaizen, if they use one.
alter table public.billing_accounts add column customer_reference text;

alter table public.app_settings add column company_phone text;
alter table public.app_settings add column company_email text;
update public.app_settings
   set company_phone = '(602) 341-5575', company_email = 'invoices@kaizen-waste.com'
 where singleton;
