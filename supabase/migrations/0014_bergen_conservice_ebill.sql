-- The Bergen's invoices go to three addresses, confirmed by Pierce:
-- synergytransition@conservice.com (To), taylor.moore@rpmliving.com (CC),
-- and synergyebill@conservice.com (CC). The third was missing.
insert into public.billing_contacts (account_id, name, email, role, source, delivery)
select a.id, 'Conservice e-bill', 'synergyebill@conservice.com', 'Copied on invoices', 'Pierce', 'cc'
from public.billing_accounts a join public.properties p on p.id = a.property_id
where p.name = 'The Bergen' and a.status = 'active'
  and not exists (select 1 from public.billing_contacts c where c.account_id = a.id and lower(c.email) = 'synergyebill@conservice.com');
