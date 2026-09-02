"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Chip, Dot, btnCls } from "@/components/ui";
import { Popover } from "@/components/Popover";
import { Chevron, Dots } from "@/components/icons";
import { ColorSwatch } from "@/components/ColorSwatch";
import type { Role } from "@/lib/roles";
import type { PaymentMethod } from "@/lib/payments";
import type { SaleItemRow, SaleWithItems, Seller } from "@/lib/queries";
import {
  normalizeItemStatus,
  normalizeOrigin,
  saleItemNet,
  saleTotal,
  type SaleOrigin,
} from "@/lib/sales";
import { cn } from "@/lib/cn";
import { EditarVentaModal } from "./EditarVentaModal";
import { DevolucionModal } from "./DevolucionModal";
import { CambioModal } from "./CambioModal";

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const fmtARS = (n: number) => arsFmt.format(n);

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

export type OriginFilter = SaleOrigin | "todos";
export type StatusFilter = "active" | "returned" | "todos";

const ORIGIN_FILTERS: { value: OriginFilter; label: string }[] = [
  { value: "todos", label: "Todas" },
  { value: "atelier", label: "Atelier" },
  { value: "shopify", label: "Shopify" },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Activas" },
  { value: "returned", label: "Con devolución" },
  { value: "todos", label: "Todas" },
];

type Modal =
  | { kind: "editar"; sale: SaleWithItems }
  | { kind: "devolucion"; sale: SaleWithItems }
  | { kind: "cambio"; sale: SaleWithItems; item: SaleItemRow };

export function VentasClient({
  rows,
  total,
  page,
  pageSize,
  query,
  month,
  origin,
  status,
  role,
  monthLabel,
  prevMonth,
  nextMonth,
  sellers,
  paymentMethods,
  currentUserId,
}: {
  rows: SaleWithItems[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  month: string;
  origin: OriginFilter;
  status: StatusFilter;
  role: Role;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  sellers: Seller[];
  paymentMethods: PaymentMethod[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const readOnly = role === "medios";

  function hrefFor(opts: {
    q?: string;
    page?: number;
    month?: string;
    origin?: OriginFilter;
    status?: StatusFilter;
  }) {
    const params = new URLSearchParams({ mes: opts.month ?? month });
    const term = (opts.q ?? query).trim();
    if (term) params.set("q", term);
    if (opts.page && opts.page > 1) params.set("p", String(opts.page));
    const nextOrigin = opts.origin ?? origin;
    if (nextOrigin !== "todos") params.set("origen", nextOrigin);
    const nextStatus = opts.status ?? status;
    if (nextStatus !== "active") params.set("estado", nextStatus);
    return `/ventas?${params.toString()}`;
  }

  // La búsqueda viaja por la URL para que filtre en la base y no solo sobre la
  // página cargada. Con debounce, para no pegarle a la DB en cada tecla.
  useEffect(() => {
    if (q === query) return;
    const timer = setTimeout(() => {
      router.replace(hrefFor({ q, page: 1 }), { scroll: false });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, month, origin, status]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleFlag(sale: SaleWithItems, field: "delivered" | "invoiced") {
    if (busy) return;
    setBusy(sale.id);
    try {
      const res = await fetch(`/api/ventas/${sale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !sale[field] }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo actualizar");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setBusy(null);
    }
  }

  async function remove(sale: SaleWithItems) {
    if (busy) return;
    const count = sale.sale_items.length;
    if (
      !confirm(
        `¿Eliminar la venta completa?\n\n` +
          `Se borran ${count === 1 ? "la prenda" : `las ${count} prendas`} y el pago. ` +
          "Eliminar es para un error de carga: no queda rastro. " +
          "Si el cliente devolvió algo, usá Devolución.",
      )
    )
      return;
    setBusy(sale.id);
    const t = toast.loading("Eliminando venta…");
    try {
      const res = await fetch(`/api/ventas/${sale.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo eliminar");
      toast.success("Venta eliminada", { id: t, description: "Stock repuesto en Shopify." });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar", { id: t });
    } finally {
      setBusy(null);
    }
  }

  const noResults = query || origin !== "todos" || status !== "active";

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <Link
            href={hrefFor({ month: prevMonth })}
            className="mono grid h-9 w-9 place-items-center rounded-full border border-line2 text-[12px] hover:border-ink/40"
          >
            ‹
          </Link>
          <span className="mono px-2 text-[11px] uppercase tracking-wider text-ink">{monthLabel}</span>
          <Link
            href={hrefFor({ month: nextMonth })}
            className="mono grid h-9 w-9 place-items-center rounded-full border border-line2 text-[12px] hover:border-ink/40"
          >
            ›
          </Link>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar artículo, cliente, vendedor, orden…"
          className="mono h-9 w-64 rounded-full border border-line2 px-3.5 text-[11px] uppercase tracking-wider outline-none placeholder:text-mut focus:border-ink/40"
        />
        <span className="mono ml-auto text-[12px] text-mut">
          {total === 0 ? "0" : `${rows.length} de ${total}`}
        </span>
      </div>

      {/* Origen y estado. Son dos ejes distintos: de qué plataforma vino la
          compra, y qué pasó con su mercadería. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <FilterGroup
          label="Plataforma"
          options={ORIGIN_FILTERS}
          value={origin}
          hrefFor={(v) => hrefFor({ origin: v, page: 1 })}
        />
        <FilterGroup
          label="Estado"
          options={STATUS_FILTERS}
          value={status}
          hrefFor={(v) => hrefFor({ status: v, page: 1 })}
        />
      </div>

      {rows.length === 0 ? (
        <div className="mt-10 grid place-items-center rounded-[4px] border border-dashed border-line py-20 text-center">
          <div className="font-serif text-[22px]">
            {noResults ? "Sin resultados" : "Sin ventas registradas"}
          </div>
          <p className="mono mt-2 text-[12px] text-mut">
            {noResults
              ? "Probá con otra búsqueda o cambiá los filtros."
              : "Acá aparecen las ventas del local y las de la tienda online."}
          </p>
          {!readOnly && !query && (
            <Link href="/ventas/nueva" className={btnCls("primary", "mt-5")}>
              Registrar venta
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1060px] border-t border-line text-left">
            <thead>
              <tr className="mono text-[10px] text-mut">
                {[
                  "Fecha",
                  "Compra",
                  "Cliente",
                  "Vendedor",
                  "Punto de venta",
                  "Pago",
                  "Total",
                  "Estado",
                  "",
                ].map((h, i) => (
                  <th key={i} className="border-b border-line py-3 pr-4 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <SaleRows
                  key={sale.id}
                  sale={sale}
                  role={role}
                  readOnly={readOnly}
                  busy={busy === sale.id}
                  open={expanded.has(sale.id)}
                  onToggleOpen={() => toggleExpanded(sale.id)}
                  onToggleFlag={(f) => toggleFlag(sale, f)}
                  onEdit={() => setModal({ kind: "editar", sale })}
                  onDevolucion={() => setModal({ kind: "devolucion", sale })}
                  onCambio={(item) => setModal({ kind: "cambio", sale, item })}
                  onRemove={() => remove(sale)}
                />
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
              <span className="mono text-[11px] text-mut">
                Página {page} de {totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                {page > 1 && (
                  <Link href={hrefFor({ page: page - 1 })} className={btnCls("ghost")}>
                    ‹ Anterior
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={hrefFor({ page: page + 1 })} className={btnCls("ghost")}>
                    Siguiente ›
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Los modales se montan con `key` para que su estado interno arranque
          limpio al pasar de una compra a otra. */}
      {modal?.kind === "editar" && (
        <EditarVentaModal
          key={modal.sale.id}
          open
          sale={modal.sale}
          onClose={() => setModal(null)}
          role={role}
          sellers={sellers}
          paymentMethods={paymentMethods}
          currentUserId={currentUserId}
        />
      )}
      {modal?.kind === "devolucion" && (
        <DevolucionModal key={modal.sale.id} open sale={modal.sale} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "cambio" && (
        <CambioModal
          key={modal.item.id}
          open
          sale={modal.sale}
          item={modal.item}
          onClose={() => setModal(null)}
          paymentMethods={paymentMethods}
        />
      )}
    </>
  );
}

/**
 * Una compra en la grilla: la fila del pago, más una fila desplegada por prenda.
 *
 * El detalle se despliega en vez de mostrarse siempre porque la mayoría de las
 * compras tiene una sola prenda y abrir todo convertiría la tabla en el doble
 * de largo sin agregar nada. La fila resumida ya dice cuántas hay.
 */
function SaleRows({
  sale,
  role,
  readOnly,
  busy,
  open,
  onToggleOpen,
  onToggleFlag,
  onEdit,
  onDevolucion,
  onCambio,
  onRemove,
}: {
  sale: SaleWithItems;
  role: Role;
  readOnly: boolean;
  busy: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggleFlag: (field: "delivered" | "invoiced") => void;
  onEdit: () => void;
  onDevolucion: () => void;
  onCambio: (item: SaleItemRow) => void;
  onRemove: () => void;
}) {
  const origin = normalizeOrigin(sale.origin);
  const items = sale.sale_items;
  const active = items.filter((i) => normalizeItemStatus(i.status) === "active");
  const returned = items.filter((i) => normalizeItemStatus(i.status) === "returned");
  const total = saleTotal(sale, items);
  const units = active.reduce((s, i) => s + i.qty, 0);
  const fullyReturned = sale.status === "returned";
  const saleDiscount = Number(sale.sale_discount) || 0;

  // El título de la fila: la primera prenda activa (o la primera a secas si
  // está todo devuelto), y el resto como recuento.
  const lead = active[0] ?? items[0];
  const others = items.length - 1;

  return (
    <>
      <tr
        className={cn(
          "border-b border-line hover:bg-panel/60",
          fullyReturned && "opacity-60",
          open && "bg-panel/40",
        )}
      >
        <td className="mono py-3 pr-4 align-top text-[12px] text-mut">
          {dateFmt.format(new Date(`${sale.sold_at}T00:00:00`))}
        </td>
        <td className="py-3 pr-4">
          <button
            type="button"
            onClick={onToggleOpen}
            className="flex items-start gap-2.5 text-left"
            aria-expanded={open}
          >
            <Chevron
              className={cn(
                "mt-1.5 h-3 w-3 shrink-0 text-mut transition-transform",
                open && "rotate-180",
              )}
            />
            {lead?.color && <ColorSwatch name={lead.color} size="sm" />}
            <span>
              <span
                className={cn(
                  "block text-[14px] font-medium",
                  fullyReturned && "line-through decoration-mut",
                )}
              >
                {lead?.article ?? "—"}
                {others > 0 && (
                  <span className="mono ml-2 text-[11px] text-mut">
                    +{others} {others === 1 ? "prenda" : "prendas"}
                  </span>
                )}
              </span>
              <span className="mono block text-[9px] uppercase text-mut2">
                {[
                  `${units}u`,
                  lead?.talle && `Talle ${lead.talle}`,
                  sale.shopify_order_name,
                  saleDiscount > 0 && `-${Math.round(saleDiscount * 100)}% compra`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
        </td>
        <td className="py-3 pr-4 align-top">
          <div className="text-[13px]">{sale.customer_name ?? "—"}</div>
          {sale.customer_contact && (
            <div className="mono text-[10px] text-mut">{sale.customer_contact}</div>
          )}
        </td>
        <td className="mono py-3 pr-4 align-top text-[11px] uppercase">
          {sale.seller_name ?? <span className="normal-case text-mut2">Sin asignar</span>}
        </td>
        <td className="mono py-3 pr-4 align-top text-[11px]">
          <div>{sale.pos ?? "—"}</div>
          <div className="text-[9px] uppercase text-mut2">
            {origin === "shopify" ? "Shopify" : "Atelier"}
          </div>
        </td>
        <td className="mono py-3 pr-4 align-top text-[11px]">
          {sale.payment_method ?? "—"}
          {sale.installments ? (
            <span className="text-mut">
              {" "}
              · {sale.installments} {sale.installments === 1 ? "cuota" : "cuotas"}
            </span>
          ) : null}
        </td>
        <td className="py-3 pr-4 align-top">
          <div className={cn("font-serif text-[17px]", fullyReturned && "text-mut line-through")}>
            {fmtARS(total)}
          </div>
          {returned.length > 0 && !fullyReturned && (
            <div className="mono text-[9px] text-acc">
              {returned.length} {returned.length === 1 ? "devuelta" : "devueltas"}
            </div>
          )}
        </td>
        <td className="py-3 pr-4 align-top">
          <div className="flex flex-wrap items-center gap-1.5">
            {fullyReturned ? (
              <Chip tone="acc">Devuelta</Chip>
            ) : (
              <>
                <button
                  onClick={() => onToggleFlag("delivered")}
                  disabled={busy || readOnly}
                  title="Alternar entregado"
                >
                  <Chip tone={sale.delivered ? "acc" : "default"}>
                    {sale.delivered ? "Entregado" : "Pendiente"}
                  </Chip>
                </button>
                <button
                  onClick={() => onToggleFlag("invoiced")}
                  disabled={busy || readOnly}
                  title="Alternar factura"
                >
                  <Chip tone="default">{sale.invoiced ? "Facturado" : "Sin factura"}</Chip>
                </button>
              </>
            )}
            {sale.invoice_path && (
              <a
                href={`/api/ventas/${sale.id}/factura`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-[10px] text-acc hover:underline"
                title="Ver factura adjunta"
              >
                Factura ↗
              </a>
            )}
          </div>
        </td>
        <td className="py-3 text-right align-top">
          {!readOnly && (
            <Popover
              align="right"
              triggerClass="inline-flex"
              panelClass="min-w-[200px] p-1.5"
              trigger={
                <span className="grid h-8 w-8 place-items-center rounded-full text-mut hover:bg-panel hover:text-ink">
                  <Dots className="h-4 w-4" />
                </span>
              }
            >
              {(close) => (
                <ul>
                  <MenuItem
                    label="Editar venta"
                    onClick={() => {
                      close();
                      onEdit();
                    }}
                  />
                  {active.length > 0 && (
                    <MenuItem
                      label="Devolución"
                      hint={active.length > 1 ? "Elegir prendas" : "Repone stock"}
                      onClick={() => {
                        close();
                        onDevolucion();
                      }}
                    />
                  )}
                  {active.length > 0 && (
                    <MenuItem
                      label="Cambio"
                      hint={active.length > 1 ? "Desplegá la compra" : "Por otra prenda"}
                      onClick={() => {
                        close();
                        // Con una sola prenda no hay nada que elegir; con
                        // varias, el cambio es por prenda y se hace desde su
                        // fila, así que se despliega el detalle.
                        if (active.length === 1) onCambio(active[0]);
                        else if (!open) onToggleOpen();
                      }}
                    />
                  )}
                  {role === "admin" && (
                    <MenuItem
                      label="Eliminar"
                      hint="Error de carga"
                      tone="acc"
                      onClick={() => {
                        close();
                        onRemove();
                      }}
                    />
                  )}
                </ul>
              )}
            </Popover>
          )}
        </td>
      </tr>

      {open &&
        items.map((item) => {
          const itemStatus = normalizeItemStatus(item.status);
          return (
            <tr key={item.id} className="border-b border-line bg-panel/40 text-[12px]">
              <td />
              <td className="py-2 pr-4" colSpan={4}>
                <div className="flex items-center gap-2.5 pl-6">
                  {item.color && <ColorSwatch name={item.color} size="sm" />}
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "text-[13px]",
                        itemStatus === "returned" && "line-through decoration-mut text-mut",
                      )}
                    >
                      {item.product_id ? (
                        <Link href={`/catalogo/${item.product_id}`} className="hover:underline">
                          {item.article}
                        </Link>
                      ) : (
                        item.article
                      )}
                      {item.qty > 1 && (
                        <span className="mono ml-2 text-[10px] text-mut">×{item.qty}</span>
                      )}
                    </div>
                    <div className="mono text-[9px] uppercase text-mut2">
                      {[
                        item.talle && `Talle ${item.talle}`,
                        item.is_other_brand ? (item.brand ?? "otra marca") : null,
                        Number(item.discount) > 0 && `-${Math.round(Number(item.discount) * 100)}%`,
                        item.exchange_of_item_id ? "entró por cambio" : null,
                        item.return_reason,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-2 pr-4 text-right">
                <span
                  className={cn(
                    "font-serif text-[14px]",
                    !item.counts_revenue && "text-mut line-through decoration-mut/60",
                  )}
                >
                  {fmtARS(saleItemNet(item, sale.sale_discount))}
                </span>
                {Number(item.exchange_adjustment) > 0 && (
                  <div className="mono text-[9px] text-acc">
                    +{fmtARS(Number(item.exchange_adjustment))} dif.
                  </div>
                )}
                {!item.counts_revenue && item.exchange_of_item_id && (
                  <div className="mono text-[9px] text-mut2">ya facturado</div>
                )}
              </td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-1.5">
                  {itemStatus === "returned" && <Chip tone="acc">Devuelta</Chip>}
                  {itemStatus === "exchanged" && <Chip>Cambiada</Chip>}
                  {itemStatus === "active" && (
                    <span
                      className="flex items-center gap-1"
                      title={
                        item.stock_deducted ? "Stock descontado en Shopify" : "No descuenta stock"
                      }
                    >
                      <Dot alert={!item.stock_deducted && !item.is_other_brand} />
                    </span>
                  )}
                </div>
              </td>
              <td className="py-2 text-right">
                {!readOnly && itemStatus === "active" && (
                  <button
                    type="button"
                    onClick={() => onCambio(item)}
                    className="mono text-[10px] text-mut hover:text-acc"
                  >
                    Cambiar
                  </button>
                )}
              </td>
            </tr>
          );
        })}
    </>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  hrefFor,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  hrefFor: (v: T) => string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mono text-[10px] uppercase tracking-wider text-mut2">{label}</span>
      {options.map((o) => (
        <Link
          key={o.value}
          href={hrefFor(o.value)}
          scroll={false}
          className={cn(
            "mono rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors",
            o.value === value
              ? "border-ink bg-ink text-white"
              : "border-line2 text-ink2 hover:border-ink/40",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  tone,
  onClick,
}: {
  label: string;
  hint?: string;
  tone?: "acc";
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-baseline justify-between gap-3 rounded-md px-3 py-2 text-left text-[13px] hover:bg-panel",
          tone === "acc" ? "text-acc" : "text-ink2",
        )}
      >
        {label}
        {hint && <span className="mono text-[9px] text-mut2">{hint}</span>}
      </button>
    </li>
  );
}
