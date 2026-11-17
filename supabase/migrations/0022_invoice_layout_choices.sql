-- An invoice can switch individual blocks on or off, on top of the template
-- its property uses. Empty means "follow the template". Like every other
-- field, it can only change while the invoice is a draft.
alter table public.invoices add column layout_options jsonb;
