-- Holding an invoice back saves with "add it, or keep it if already there",
-- which the database treats as a possible update. That permission was missing.
grant update on public.send_holds to authenticated;
