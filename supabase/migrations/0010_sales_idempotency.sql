-- ============================================================
-- 0010 — Idempotencia en la carga de ventas
--
-- El único freno a la doble carga era el flag `saving` del cliente, que no
-- sobrevive a un doble tap en móvil con red lenta ni a un reintento del
-- navegador: la venta se duplicaba Y el stock se descontaba dos veces en
-- Shopify. Ahora el cliente manda una clave por intento y este índice es el
-- que arbitra, del lado del servidor.
-- ============================================================

alter table public.sales add column if not exists idempotency_key text;

-- Índice parcial: en Postgres los NULL no colisionan entre sí en un índice
-- único, así que las ventas viejas y cualquier carga sin clave conviven sin
-- problema. Lo hacemos parcial igual para no indexarlos al pedo.
create unique index if not exists idx_sales_idempotency_key
  on public.sales (idempotency_key)
  where idempotency_key is not null;
