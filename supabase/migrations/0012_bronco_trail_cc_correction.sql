-- Correction to 0011. The address synergyebill1570@conservice.com was issued
-- by Conservice for Shorehaven only (their request of June 8, 2026, account
-- KW-sh612). QuickBooks has also been copying it on Village at Bronco Trail
-- invoices, which is a carry-over and not a Bronco Trail contact, so it is
-- removed there. It stays on Shorehaven.
delete from public.billing_contacts c
using public.billing_accounts a, public.properties p
where c.account_id = a.id and p.id = a.property_id
  and p.name = 'Village at Bronco Trail'
  and lower(c.email) = 'synergyebill1570@conservice.com';
