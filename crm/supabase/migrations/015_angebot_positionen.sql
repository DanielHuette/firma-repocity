alter table crm.quote_items add column if not exists scope text not null default '';
alter table crm.quote_items add column if not exists billing text;
alter table crm.quote_items add column if not exists vat_note text not null default '';

alter table crm.quote_items drop constraint if exists quote_items_billing_check;
alter table crm.quote_items add constraint quote_items_billing_check check (billing is null or billing in ('once', 'monthly', 'hourly', 'piece'));

notify pgrst, 'reload schema';
