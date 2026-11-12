-- Replies to anything the app sends go to the shared invoices inbox, and
-- Pierce is copied on every email that goes to a customer.
alter table public.app_settings add column if not exists always_cc text[] not null default '{}';
update public.app_settings
   set email_reply_to = 'invoices@kaizen-waste.com',
       always_cc = array['pierce@kaizen-waste.com'];
