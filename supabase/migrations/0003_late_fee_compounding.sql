-- Pierce confirmed on 2026-11-10 that the 3% monthly late fee compounds:
-- each month's 3% is charged on the unpaid charges plus any earlier late fees
-- on that invoice.
update public.late_fee_templates set compounding = true where name = '3% monthly';
