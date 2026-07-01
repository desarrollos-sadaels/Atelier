-- Todas las imágenes del producto (de Shopify) para el carrusel.
alter table public.products add column if not exists images text[];
