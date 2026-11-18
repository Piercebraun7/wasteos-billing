-- Sending an approved invoice back to Review. A posted invoice is never
-- edited (hard rule 6), so this is "void and reissue" done in one step:
-- the approved invoice is voided, keeping its number on file, and an exact
-- copy is put back in Review as a draft that can be changed and approved again.
create function public.return_to_review(p_invoice_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_old public.invoices;
  v_new uuid;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can send an invoice back to review.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_old from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'no_data_found';
  end if;
  if v_old.status <> 'approved' then
    raise exception 'Only an approved invoice that has not been sent can go back to review.' using errcode = 'restrict_violation';
  end if;

  -- Takes it off the balance and frees its month and any logged work on it.
  perform public.void_invoice(p_invoice_id, 'Sent back to review before sending');
  delete from public.send_holds where invoice_id = p_invoice_id;

  insert into public.invoices (account_id, service_month, invoice_date, due_date, status, subtotal_cents, tax_cents, total_cents,
                               origin, kind, service_category, memo, recurring_invoice_id, late_fee_for, late_fee_period, layout_options)
  values (v_old.account_id, v_old.service_month, v_old.invoice_date, v_old.due_date, 'draft', v_old.subtotal_cents, v_old.tax_cents, v_old.total_cents,
          v_old.origin, v_old.kind, v_old.service_category, v_old.memo, v_old.recurring_invoice_id, v_old.late_fee_for, v_old.late_fee_period, v_old.layout_options)
  returning id into v_new;

  insert into public.invoice_lines (invoice_id, line_type, description, quantity, unit_price_cents, amount_cents, contract_phase_id,
                                    billable_event_id, related_invoice_id, period_start, period_end, sort_order, service_item_id)
  select v_new, line_type, description, quantity, unit_price_cents, amount_cents, contract_phase_id,
         billable_event_id, related_invoice_id, period_start, period_end, sort_order, service_item_id
  from public.invoice_lines where invoice_id = p_invoice_id;

  return v_new;
end
$$;
revoke all on function public.return_to_review(uuid) from public, anon;
grant execute on function public.return_to_review(uuid) to authenticated, service_role;
