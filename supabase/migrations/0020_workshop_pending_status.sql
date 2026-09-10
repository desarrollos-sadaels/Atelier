-- Nuevo estado inicial de Taller. Los pedidos existentes conservan su valor.
alter table public.workshop_orders
  alter column status set default 'pending_send';

alter table public.workshop_orders
  drop constraint if exists workshop_orders_status_check;

alter table public.workshop_orders
  add constraint workshop_orders_status_check
  check (status in ('pending_send', 'in_process', 'finished'));
