-- Late fees and the overdue notice.
-- An invoice is given five days past its due date before anything happens.
-- After that, a late fee of 3% of what is unpaid is drafted, and again every
-- 30 days while it stays unpaid. Each fee is its own small invoice, so it is
-- reviewed and approved like any other, posts to QuickBooks, shows on the
-- account, and can be removed by voiding it.
update public.late_fee_templates
   set grace_days = 5, frequency = 'recurring', recurrence_interval_days = coalesce(recurrence_interval_days, 30)
 where percent_bps = 300;

alter table public.invoices add column late_fee_for uuid references public.invoices (id);
alter table public.invoices add column late_fee_period integer check (late_fee_period is null or late_fee_period >= 1);
alter table public.invoices add constraint invoices_late_fee_pair check ((late_fee_for is null) = (late_fee_period is null));
-- One fee per invoice per period, however many times the check runs.
create unique index invoices_one_late_fee_per_period on public.invoices (late_fee_for, late_fee_period)
  where late_fee_for is not null and status <> 'void';

alter table public.app_settings add column overdue_grace_days integer not null default 5 check (overdue_grace_days >= 0);
