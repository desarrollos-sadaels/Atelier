-- URL de la imagen principal del producto (de Shopify).
alter table public.products add column if not exists image_url text;
