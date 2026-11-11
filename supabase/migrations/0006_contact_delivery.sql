-- Kaizen Billing: To and CC contacts, and removing a property.
-- Runs as one transaction: if any statement fails, nothing changes.
begin;

-- A contact either receives the invoice (To) or is copied on it (CC).
alter table public.billing_contacts
  add column delivery text not null default 'to' check (delivery in ('to', 'cc'));

-- Removes a property. One that has never been invoiced is deleted outright,
-- with its drafts, schedule, and contacts. One with any billing history is
-- archived instead: billing stops, and its invoices and balance stay intact.
create function public.delete_billing_account(p_account_id uuid) returns text
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
    update public.billing_accounts set status = 'inactive' where id = p_account_id;
    return 'archived';
  end if;

  delete from public.invoice_lines where invoice_id in (select id from public.invoices where account_id = p_account_id);
  delete from public.invoices where account_id = p_account_id;
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
  -- A client with nothing left under it goes too.
  if not exists (select 1 from public.billing_accounts where customer_id = v_customer)
     and not exists (select 1 from public.payments where customer_id = v_customer)
     and not exists (select 1 from public.customer_users where customer_id = v_customer) then
    delete from public.customers where id = v_customer;
  end if;
  return 'deleted';
end
$$;

revoke all on function public.delete_billing_account(uuid) from public, anon;
grant execute on function public.delete_billing_account(uuid) to authenticated, service_role;

commit;
