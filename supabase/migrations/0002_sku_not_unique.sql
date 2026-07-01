-- Los SKUs de Shopify no son únicos entre productos; el único real es shopify_id.
alter table public.products drop constraint if exists products_sku_key;
create index if not exists idx_products_sku on public.products (sku);
