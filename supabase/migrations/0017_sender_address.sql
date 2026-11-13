-- Email goes out from the address verified with the sending service.
-- Replies still go to invoices@kaizen-waste.com.
update public.app_settings
   set email_sender = 'Kaizen Waste <no-reply@msg.kaizen-waste.com>'
 where singleton;
