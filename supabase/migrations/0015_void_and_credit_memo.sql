-- Corrections to posted invoices (hard rule 6): void, or a credit memo.
-- Both need a reason, both post to the ledger, neither edits the invoice.

-- Void: cancels an invoice that has had nothing paid or credited against it.
-- The invoice keeps its number and stays on file; a reversing ledger entry
-- takes it off the balance, and its month can then be drafted again.
create function public.void_invoice(p_invoice_id uuid, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can void invoices.' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to void an invoice.' using errcode = 'check_violation';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'no_data_found';
  end if;
  if v_invoice.status not in ('approved', 'sent') then
    raise exception 'Only an approved or sent invoice with nothing paid on it can be voided.' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from public.payment_applications where invoice_id = v_invoice.id)
     or exists (select 1 from public.credit_memos where invoice_id = v_invoice.id) then
    raise exception 'This invoice has a payment or credit against it, so it cannot be voided. Use a credit memo instead.' using errcode = 'restrict_violation';
  end if;

  update public.invoices set status = 'void', void_reason = trim(p_reason) where id = v_invoice.id;

  insert into public.ledger_entries (account_id, entry_date, entry_type, amount_cents, source_table, source_id, description)
  values (v_invoice.account_id, (now() at time zone 'America/Phoenix')::date, 'invoice', -v_invoice.total_cents, 'invoices', v_invoice.id,
          'Invoice ' || v_invoice.invoice_number || ' voided: ' || trim(p_reason));

  -- Logged work on the voided invoice becomes billable again.
  update public.billable_events set status = 'approved'
   where id in (select billable_event_id from public.invoice_lines
                where invoice_id = v_invoice.id and billable_event_id is not null);
end
$$;

-- Credit memo: takes an amount off what a property owes. Tied to an invoice,
-- it cannot exceed what is still open on that invoice.
create function public.issue_credit_memo(p_account_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_reason text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_open bigint;
  v_id uuid;
  v_today date := (now() at time zone 'America/Phoenix')::date;
begin
  if not private.is_billing_admin() then
    raise exception 'Only a billing admin can issue credit memos.' using errcode = 'insufficient_privilege';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'The credit amount must be more than zero.' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required for a credit memo.' using errcode = 'check_violation';
  end if;

  if p_invoice_id is not null then
    select * into v_invoice from public.invoices where id = p_invoice_id for update;
    if not found or v_invoice.account_id <> p_account_id then
      raise exception 'Invoice not found on this account.' using errcode = 'no_data_found';
    end if;
    if v_invoice.status not in ('approved', 'sent', 'partially_paid') then
      raise exception 'A credit memo can only go against an approved or sent invoice that is not fully paid.' using errcode = 'restrict_violation';
    end if;
    v_open := v_invoice.total_cents
      - coalesce((select sum(amount_cents) from public.payment_applications where invoice_id = v_invoice.id), 0)
      - coalesce((select sum(amount_cents) from public.credit_memos where invoice_id = v_invoice.id), 0);
    if p_amount_cents > v_open then
      raise exception 'The credit is more than the % still open on this invoice.', to_char(v_open / 100.0, 'FM$999,999,990.00') using errcode = 'check_violation';
    end if;
  end if;

  insert into public.credit_memos (account_id, invoice_id, amount_cents, reason, memo_date)
  values (p_account_id, p_invoice_id, p_amount_cents, trim(p_reason), v_today)
  returning id into v_id;

  insert into public.ledger_entries (account_id, entry_date, entry_type, amount_cents, source_table, source_id, description)
  values (p_account_id, v_today, 'credit', -p_amount_cents, 'credit_memos', v_id,
          'Credit memo' || coalesce(' on invoice ' || v_invoice.invoice_number, '') || ': ' || trim(p_reason));

  if p_invoice_id is not null then
    update public.invoices
       set status = case when p_amount_cents = v_open then 'paid' else 'partially_paid' end
     where id = p_invoice_id and status <> 'approved';
  end if;
  return v_id;
end
$$;

revoke all on function public.void_invoice(uuid, text), public.issue_credit_memo(uuid, uuid, bigint, text) from public, anon;
grant execute on function public.void_invoice(uuid, text), public.issue_credit_memo(uuid, uuid, bigint, text) to authenticated, service_role;
