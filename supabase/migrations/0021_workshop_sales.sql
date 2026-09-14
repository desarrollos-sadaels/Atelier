-- ============================================================
-- 0021 — Los pedidos de Taller también son ventas del Atelier.
--
-- Taller conserva su flujo operativo, pero precio/envío pasan a ser snapshots
-- comerciales. Cada pedido genera exactamente una compra en `sales`, visible
-- en Ventas y en los KPIs, sin tocar inventario ni escribir en Shopify.
-- ============================================================

alter table public.workshop_orders
  add column if not exists price numeric not null default 0,
  add column if not exists shipping_amount numeric not null default 0,
  add column if not exists variant_label text;

do $$ begin
  alter table public.workshop_orders
    add constraint workshop_orders_price_non_negative check (price >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.workshop_orders
    add constraint workshop_orders_shipping_non_negative check (shipping_amount >= 0);
exception when duplicate_object then null; end $$;

-- La relación vive en la venta: al borrar un pedido desde Taller se elimina su
-- compra y sus prendas (sale_items ya tiene ON DELETE CASCADE). A la inversa,
-- la API de Ventas impide borrar directamente una compra originada en Taller.
alter table public.sales
  add column if not exists workshop_order_id uuid
    references public.workshop_orders(id) on delete cascade;

create unique index if not exists idx_sales_workshop_order_unique
  on public.sales (workshop_order_id);

-- Si el frontend creó la venta mediante la compatibilidad para el esquema
-- anterior, recuperar primero el precio y el envío realmente ingresados.
update public.workshop_orders w
set
  price = coalesce((
    select i.price
    from public.sales s
    join public.sale_items i on i.sale_id = s.id
    where s.idempotency_key = 'workshop:' || w.id::text
      and i.exchange_of_item_id is null
      and i.shopify_line_item_id is null
    order by i.created_at, i.id
    limit 1
  ), w.price),
  shipping_amount = coalesce((
    select s.shipping_amount
    from public.sales s
    where s.idempotency_key = 'workshop:' || w.id::text
    limit 1
  ), w.shipping_amount)
where exists (
  select 1 from public.sales s
  where s.idempotency_key = 'workshop:' || w.id::text
);

-- Los demás pedidos previos no tenían precio. Se toma el precio actual del
-- producto como punto de partida para que también entren al historial; el
-- equipo puede corregir el snapshot desde Taller si el valor acordado fue otro.
update public.workshop_orders w
set price = coalesce(p.price, 0)
from public.products p
where p.id = w.product_id
  and w.price = 0
  and not exists (
    select 1 from public.sales s
    where s.idempotency_key = 'workshop:' || w.id::text
  );

create or replace function public.sync_workshop_order_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_sale_id uuid;
  linked_item_id uuid;
begin
  select s.id into linked_sale_id
  from public.sales s
  where s.workshop_order_id = new.id
     or s.idempotency_key = 'workshop:' || new.id::text
  order by (s.workshop_order_id = new.id) desc nulls last
  limit 1;

  if linked_sale_id is null then
    insert into public.sales (
      sold_at,
      seller_id,
      seller_name,
      customer_name,
      customer_contact,
      origin,
      payment_method,
      pos,
      shipping_amount,
      delivered,
      notes,
      idempotency_key,
      workshop_order_id
    ) values (
      (new.created_at at time zone 'America/Argentina/Buenos_Aires')::date,
      new.created_by,
      new.created_by_name,
      new.customer_name,
      new.customer_contact,
      'atelier',
      null,
      'TALLER',
      new.shipping_amount,
      false,
      new.detail,
      'workshop:' || new.id::text,
      new.id
    )
    returning id into linked_sale_id;
  else
    update public.sales
    set
      customer_name = new.customer_name,
      customer_contact = new.customer_contact,
      shipping_amount = new.shipping_amount,
      notes = new.detail,
      origin = 'atelier',
      pos = 'TALLER',
      idempotency_key = 'workshop:' || new.id::text,
      workshop_order_id = new.id
    where id = linked_sale_id;
  end if;

  -- La primera prenda sin padre de cambio es la prenda original del pedido.
  -- Las prendas que puedan aparecer después por un cambio no se pisan.
  select i.id into linked_item_id
  from public.sale_items i
  where i.sale_id = linked_sale_id
    and i.exchange_of_item_id is null
    and i.shopify_line_item_id is null
  order by i.created_at, i.id
  limit 1;

  if linked_item_id is null then
    insert into public.sale_items (
      sale_id,
      product_id,
      variant_gid,
      article,
      color,
      talle,
      qty,
      price,
      discount,
      stock_deducted,
      counts_revenue
    ) values (
      linked_sale_id,
      new.product_id,
      null,
      new.product_name,
      new.color,
      new.talle,
      1,
      new.price,
      0,
      false,
      true
    );
  else
    update public.sale_items
    set
      product_id = new.product_id,
      variant_gid = null,
      article = new.product_name,
      color = new.color,
      talle = new.talle,
      price = new.price,
      stock_deducted = false
    where id = linked_item_id;
  end if;

  return null;
end;
$$;

revoke execute on function public.sync_workshop_order_sale() from public;

drop trigger if exists workshop_orders_sync_sale on public.workshop_orders;
create trigger workshop_orders_sync_sale
after insert or update of
  customer_name,
  customer_contact,
  product_id,
  product_name,
  color,
  talle,
  detail,
  price,
  shipping_amount
on public.workshop_orders
for each row execute function public.sync_workshop_order_sale();

-- Dispara la sincronización una vez para todos los pedidos que ya existían.
update public.workshop_orders
set shipping_amount = shipping_amount;
