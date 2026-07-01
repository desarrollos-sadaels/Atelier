-- Bucket público para imágenes de producto subidas desde Atelier.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Usuarios autenticados pueden subir; lectura pública (Shopify ingesta por URL).
drop policy if exists "product_images_auth_insert" on storage.objects;
create policy "product_images_auth_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
  on storage.objects for select to public
  using (bucket_id = 'product-images');
