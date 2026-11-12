-- Kaizen Billing: invoice contacts and bulk trash services, carried over from QuickBooks.
-- Each contact is the address that property's invoices are emailed to in QuickBooks today.
-- They are added unconfirmed, so the Contacts page asks for each to be checked.
-- Safe to run more than once. Billing is left OFF for everything it adds.

do $do$
declare
  r record;
  v_account uuid;
  v_customer uuid;
  v_property uuid;
  v_contract uuid;
  v_template uuid;
begin
  -- Only for Kaizen's live data: skipped on an empty database (for example in tests).
  if not exists (select 1 from public.properties where name = 'Village at Liberty Farms') then
    return;
  end if;
  select id into v_template from public.late_fee_templates where name = '3% monthly';

  -- Bulk-only customers that are not in Notion's Managed Properties.
  for r in select * from (values
    ('Village at Camelback Park', 'Stellar Residential'),
    ('Village at Harvard Crossing', 'Stellar Residential'),
    ('The Isabella', 'The Isabella')
  ) as v(property_name, client_name) loop
    if exists (select 1 from public.properties where name = r.property_name) then continue; end if;
    select id into v_customer from public.customers where name = r.client_name;
    if v_customer is null then
      insert into public.customers (name) values (r.client_name) returning id into v_customer;
    end if;
    insert into public.properties (name, state) values (r.property_name, 'AZ') returning id into v_property;
    insert into public.billing_accounts (property_id, customer_id, go_live_service_month)
    values (v_property, v_customer, date '2026-12-01') returning id into v_account;
    insert into public.contracts (account_id, billing_model, service_category, net_days, late_fee_template_id, quoted_basis, expected_monthly_cents)
    values (v_account, 'per_event', 'bulk', 30, v_template, 'pre_tax', 35000) returning id into v_contract;
    insert into public.contract_event_rates (contract_id, event_type, rate_cents, label)
    values (v_contract, 'bulk_pickup', 35000, 'Per full load');
  end loop;

  -- Bulk trash as its own service on properties that also have a monthly service.
  for r in select * from (values
    ('Village at Carver Mtn.', 35000),
    ('Village at the BLVD', 35000),
    ('Village at Liberty Farms', 30000),
    ('Shorehaven', 35000)
  ) as v(property_name, rate_cents) loop
    select a.id into v_account from public.billing_accounts a join public.properties p on p.id = a.property_id
    where p.name = r.property_name and a.status = 'active' limit 1;
    if v_account is null then continue; end if;
    if exists (select 1 from public.contracts where account_id = v_account and service_category = 'bulk') then continue; end if;
    -- The bulk rate moves to the bulk service, so each pickup lands on the bulk invoice.
    delete from public.contract_event_rates where event_type = 'bulk_pickup'
      and contract_id in (select id from public.contracts where account_id = v_account);
    insert into public.contracts (account_id, billing_model, service_category, net_days, late_fee_template_id, quoted_basis, expected_monthly_cents)
    values (v_account, 'per_event', 'bulk', 30, v_template, 'pre_tax', r.rate_cents) returning id into v_contract;
    insert into public.contract_event_rates (contract_id, event_type, rate_cents, label)
    values (v_contract, 'bulk_pickup', r.rate_cents, 'Per full load');
  end loop;

  -- Who each property's invoices are emailed to in QuickBooks today.
  for r in select * from (values
    ('Village at Liberty Farms', 'Property contact', 'smcintire@stellarresidential.com'),
    ('The Bergen', 'Conservice (invoice processing)', 'synergytransition@conservice.com'),
    ('Village at Carver Mtn.', 'Property contact', 'tjohnson@stellarresidential.com'),
    ('Village at Pleasant River', 'Amanda Green', 'agreen@stellarresidential.com'),
    ('Village at Skyline Ranch', 'Property contact', 'jhyland@stellarresidential.com'),
    ('Village at Sonoran Vista', 'Bernadette Mayfield', 'bmayfield@stellarresidential.com'),
    ('Village at San Tan', 'Property contact', 'mpedraza@stellarresidential.com'),
    ('Bungalows on Sarival', 'Bungalows on Sarival office', 'bungalowsonsarival@rpmliving.com'),
    ('Avalon Townhomes', 'Vanessa Cintron', 'vcintron@stellarresidential.com'),
    ('Rainbow Road', 'Quartr Living (AppFolio invoices)', 'quartrliving@invoices.appfolio.com'),
    ('Village at Bronco Trail', 'Property contact', 'stinagero@stellarresidential.com'),
    ('Village at the BLVD', 'Property contact', 'drodriguez@stellarresidential.com'),
    ('Zenn at Skyview', 'Melanie Maddox', 'melanie.maddox@zendoor.com'),
    ('Shorehaven', 'Emily Mueller', 'emily.mueller@rpmliving.com'),
    ('Ascend at Black Canyon', 'Ascend at Black Canyon manager', 'blackcanyonapartments.mgr@liveamc.com'),
    ('ELUX at McQueen', 'Sherri English', 'sherri.english@mark-taylor.com'),
    ('Broadstone Portland', 'Joanna Flores', 'joanna.flores@rpmliving.com'),
    ('Village at Camelback Park', 'Property contact', 'jhyland@stellarresidential.com'),
    ('Village at Harvard Crossing', 'Property contact', 'drodriguez@stellarresidential.com'),
    ('The Isabella', 'Leasing office', 'leasing@liveisabella.com')
  ) as v(property_name, contact_name, email) loop
    select a.id into v_account from public.billing_accounts a join public.properties p on p.id = a.property_id
    where p.name = r.property_name and a.status = 'active' limit 1;
    if v_account is null then continue; end if;
    if exists (select 1 from public.billing_contacts where account_id = v_account and lower(email) = r.email) then continue; end if;
    insert into public.billing_contacts (account_id, name, email, role, source)
    values (v_account, r.contact_name, r.email, 'Receives invoices', 'QuickBooks');
  end loop;
end
$do$;
