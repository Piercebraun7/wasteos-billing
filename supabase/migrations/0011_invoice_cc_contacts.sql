-- Extra recipients copied on each property's invoices today, read from the
-- To and CC lines of the QuickBooks invoice emails sent in October and
-- November 2026. Loaded as unconfirmed CC contacts so they are checked on
-- the Contacts page before anything is sent.
do $do$
declare
  r record;
  v_account uuid;
begin
  for r in select * from (values
    ('Shorehaven', 'Conservice (invoice processing)', 'synergyebill1570@conservice.com'),
    ('Village at Bronco Trail', 'Conservice (invoice processing)', 'synergyebill1570@conservice.com'),
    ('Ascend at Black Canyon', 'AMC invoice inbox', 'blackcanyonapartmentsamc.invoices@factura.ai'),
    ('ELUX at McQueen', 'ELUX invoice inbox', 'invoices.elux@mark-taylor.com'),
    ('Village at the BLVD', 'The BLVD office', 'theblvd@stellarresidential.com'),
    ('The Bergen', 'Taylor Moore', 'taylor.moore@rpmliving.com'),
    ('The Isabella', 'A. Ruiz', 'aruiz@stellarresidential.com')
  ) as v(property_name, contact_name, email) loop
    select a.id into v_account from public.billing_accounts a join public.properties p on p.id = a.property_id
    where p.name = r.property_name and a.status = 'active' limit 1;
    if v_account is null then continue; end if;
    if exists (select 1 from public.billing_contacts where account_id = v_account and lower(email) = r.email) then continue; end if;
    insert into public.billing_contacts (account_id, name, email, role, source, delivery)
    values (v_account, r.contact_name, r.email, 'Copied on invoices', 'QuickBooks emails', 'cc');
  end loop;
end
$do$;
