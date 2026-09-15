-- ============================================================
-- 0023 — Preventa: la compra existe antes que la prenda
--
-- No confundir con `products.is_preorder` (0019): esa es una etiqueta del
-- PRODUCTO en el catálogo; esta marca la COMPRA. Son independientes: ninguna
-- se deriva de la otra.
--
-- Hasta acá el modelo asumía que toda venta salía con mercadería en la mano y
-- que `delivered` era un trámite: la prenda estaba, faltaba entregarla. La
-- preventa rompe ese supuesto — se cobra una prenda que todavía no existe (no
-- se produjo, o está en camino), y esa compra puede quedar semanas sin
-- entregar. Sin una marca propia, en el listado se veía igual que la venta del
-- local que el vendedor se olvidó de tildar: las dos decían "Pendiente", y
-- justo la que hay que seguir de cerca quedaba escondida entre los olvidos.
--
-- Son DOS columnas y no una porque son dos preguntas distintas:
--
--   `preorder`  — QUÉ SE VENDIÓ: mercadería futura. No cambia nunca; es la
--                 naturaleza de esa compra y queda como historia aunque la
--                 prenda después se entregue.
--   `delivered` — DÓNDE ESTÁ LA MERCADERÍA HOY. Avanza una sola vez, de false
--                 a true, cuando el cliente se la lleva.
--
-- De ahí sale el estado que muestra la pantalla, y por eso no hace falta un
-- estado nuevo en `sales.status` (que sigue siendo activa/devuelta):
--
--   delivered            -> "Entregado"
--   preorder             -> "Esperando entrega"
--   ninguna              -> "Pendiente"
--
-- Una preventa NACE sin entregar; eso lo garantiza la API (`POST /api/ventas`
-- fuerza `delivered = false` cuando la compra entra como preventa). No hay
-- constraint que lo prohíba para siempre a propósito: cuando la prenda llega y
-- se entrega, la fila queda con las dos en true, que es exactamente lo que pasó.
--
-- Sin GRANT de escritura sobre la columna, y no es un olvido: la 0015 acotó el
-- UPDATE desde el browser a `delivered` e `invoiced` justamente para que la
-- app no pudiera saltear la validación de la API. La preventa se marca desde
-- `POST /api/ventas` y `PATCH /api/ventas/[id]`, que escriben con service_role.
-- ============================================================

alter table public.sales
  add column if not exists preorder boolean not null default false;

-- Las preventas que todavía deben mercadería: el filtro "Esperando entrega" del
-- listado, siempre acotado al mes. Parcial y no un índice sobre `preorder` a
-- secas porque son un puñado de filas entre todas las ventas — el índice
-- completo pesaría lo mismo que la tabla para responder la única pregunta que
-- se hace. El predicado repite el WHERE del filtro (ver `getSales`); si uno
-- cambia, el otro deja de usar el índice.
create index if not exists idx_sales_preorder_pending
  on public.sales (sold_at desc)
  where preorder and not delivered and status = 'active';

comment on column public.sales.preorder is
  'Preventa: la compra se cobró antes de tener la mercadería. Junto con `delivered` define el estado de entrega que muestra el listado.';
