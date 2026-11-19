alter table crm.products add column if not exists category text not null default '' check (length(category) <= 100);
alter table crm.products add column if not exists scope text not null default '';
alter table crm.products add column if not exists vat_note text not null default '';

alter table crm.products drop constraint if exists products_billing_check;
alter table crm.products add constraint products_billing_check check (billing in ('once', 'monthly', 'hourly', 'piece'));

notify pgrst, 'reload schema';
