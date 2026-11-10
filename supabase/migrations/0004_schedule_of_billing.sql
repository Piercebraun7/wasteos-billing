-- Kaizen Billing: schedule of billing and contract files.
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- The uploaded signed contract, and what was read out of it for review.
alter table public.contracts
  add column contract_file_path text,
  add column contract_file_name text,
  add column scraped_terms jsonb;

-- Replaces a contract's phases in one step. If any existing phase has already
-- been invoiced, the database refuses and nothing changes.
create function public.replace_contract_phases(p_contract_id uuid, p_phases jsonb) returns integer
language plpgsql
set search_path = ''
as $$
declare
  ph jsonb;
  n integer := 0;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can change a schedule.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(coalesce(p_phases, '[]'::jsonb)) = 0 then
    raise exception 'There are no phases to save.' using errcode = 'check_violation';
  end if;
  delete from public.contract_phases where contract_id = p_contract_id;
  for ph in select * from jsonb_array_elements(p_phases) loop
    insert into public.contract_phases
      (contract_id, label, effective_start, billable_units, rate_per_unit_cents, flat_amount_cents)
    values (
      p_contract_id, ph ->> 'label', (ph ->> 'effective_start')::date,
      nullif(ph ->> 'billable_units', '')::integer,
      nullif(ph ->> 'rate_per_unit_cents', '')::bigint,
      nullif(ph ->> 'flat_amount_cents', '')::bigint
    );
    n := n + 1;
  end loop;
  return n;
end
$$;

revoke all on function public.replace_contract_phases(uuid, jsonb) from public, anon;
grant execute on function public.replace_contract_phases(uuid, jsonb) to authenticated, service_role;

-- Private storage for signed contracts (served only through short-lived signed links).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('contracts', 'contracts', false)
    on conflict (id) do nothing;
    execute $p$create policy billing_admin_contract_files on storage.objects for all to authenticated
      using (bucket_id = 'contracts' and private.is_billing_admin())
      with check (bucket_id = 'contracts' and private.is_billing_admin())$p$;
  end if;
end
$$;

commit;
