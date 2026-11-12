-- Kaizen Billing: resident refunds, payment reminders, and automatic drafting.
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- The scheduled job (drafting the month a week early) runs with the service
-- key, not as a signed-in person. It is allowed to do what a billing admin can.
create or replace function private.is_billing_admin() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'billing_admin', false)
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

-- A resident refund is logged against a property as a credit (a negative
-- amount) and comes off its next monthly invoice.
alter table public.billable_events drop constraint billable_events_event_type_check;
alter table public.billable_events add constraint billable_events_event_type_check
  check (event_type in ('dumpster_move', 'bulk_pickup', 'as_needed', 'trash_room_visit', 'other', 'resident_refund'));
alter table public.billable_events drop constraint billable_events_rate_cents_check;
alter table public.billable_events add constraint billable_events_rate_cents_check
  check (rate_cents is null or rate_cents >= 0 or event_type = 'resident_refund');

insert into public.service_items (name, category, description, default_rate_cents, sort_order)
values ('Resident Refund', 'other', 'Resident refund', null, 105)
on conflict (name) do nothing;

-- Reminders are logged with the other emails.
alter table public.email_sends drop constraint email_sends_kind_check;
alter table public.email_sends add constraint email_sends_kind_check
  check (kind in ('invoice', 'statement', 'notice', 'reminder'));

alter table public.app_settings
  -- manual: each reminder waits for approval. automatic: sent on the due date.
  add column reminder_mode text not null default 'manual' check (reminder_mode in ('manual', 'automatic')),
  -- How many days before the 1st the month's invoices are drafted.
  add column draft_days_before integer not null default 7 check (draft_days_before between 0 and 27),
  add column email_signoff text not null default 'Kaizen Development Team';

commit;
