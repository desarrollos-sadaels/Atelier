"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Chip, Dot, btnCls } from "@/components/ui";
import { ColorSwatch } from "@/components/ColorSwatch";
import type { Role } from "@/lib/roles";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/cn";

type SaleRow = Tables<"sales">;

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const fmtARS = (n: number) => arsFmt.format(n);

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

export function VentasClient({
  rows,
  role,
  monthLabel,
  prevMonth,
  nextMonth,
}: {
  rows: SaleRow[];
  role: Role;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      `${r.article} ${r.customer_name ?? ""} ${r.seller_name ?? ""} ${r.brand ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, q]);

  async function toggle(sale: SaleRow, field: "delivered" | "invoiced") {
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

  async function remove(sale: SaleRow) {
    if (busy) return;
    if (!confirm(`¿Eliminar la venta de "${sale.article}"?${sale.stock_deducted ? " Se repone el stock descontado." : ""}`))
      return;
    setBusy(sale.id);
    const t = toast.loading("Eliminando venta…");
    try {
      const res = await fetch(`/api/ventas/${sale.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo eliminar");
      toast.success("Venta eliminada", {
        id: t,
        description: sale.stock_deducted ? "Stock repuesto en Shopify." : undefined,
      });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar", { id: t });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/ventas?mes=${prevMonth}`}
            className="mono grid h-9 w-9 place-items-center rounded-full border border-line2 text-[12px] hover:border-ink/40"
          >
            ‹
          </Link>
          <span className="mono px-2 text-[11px] uppercase tracking-wider text-ink">{monthLabel}</span>
          <Link
            href={`/ventas?mes=${nextMonth}`}
            className="mono grid h-9 w-9 place-items-center rounded-full border border-line2 text-[12px] hover:border-ink/40"
          >
            ›
          </Link>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar artículo, cliente, vendedor…"
          className="mono h-9 w-64 rounded-full border border-line2 px-3.5 text-[11px] uppercase tracking-wider outline-none placeholder:text-mut focus:border-ink/40"
        />
        <span className="mono ml-auto text-[12px] text-mut">
          {filtered.length} / {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-10 grid place-items-center rounded-[4px] border border-dashed border-line py-20 text-center">
          <div className="font-serif text-[22px]">Sin ventas registradas</div>
          <p className="mono mt-2 text-[12px] text-mut">
            {rows.length === 0
              ? "Las ventas que cargues van a aparecer acá y descuentan stock automáticamente."
              : "Probá con otra búsqueda."}
          </p>
          {role !== "medios" && rows.length === 0 && (
            <Link href="/ventas/nueva" className={btnCls("primary", "mt-5")}>
              Registrar venta
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[980px] border-t border-line text-left">
            <thead>
              <tr className="mono text-[10px] text-mut">
                {["Fecha", "Artículo", "Cliente", "Vendedor", "Punto de venta", "Pago", "Precio", "Estado", ""].map(
                  (h, i) => (
                    <th key={i} className="border-b border-line py-3 pr-4 font-normal">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const net = Number(r.price) * (1 - Number(r.discount));
                return (
                  <tr key={r.id} className="border-b border-line hover:bg-panel/60">
                    <td className="mono py-3 pr-4 text-[12px] text-mut">
                      {dateFmt.format(new Date(`${r.sold_at}T00:00:00`))}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        {r.color && <ColorSwatch name={r.color} size="sm" />}
                        <div>
                          <div className="text-[14px] font-medium">
                            {r.product_id ? (
                              <Link href={`/catalogo/${r.product_id}`} className="hover:underline">
                                {r.article}
                              </Link>
                            ) : (
                              r.article
                            )}
                            {r.qty > 1 && <span className="mono ml-2 text-[11px] text-mut">×{r.qty}</span>}
                          </div>
                          <div className="mono text-[9px] uppercase text-mut2">
                            {[r.talle && `Talle ${r.talle}`, r.is_other_brand ? (r.brand ?? "otra marca") : null]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="text-[13px]">{r.customer_name ?? "—"}</div>
                      {r.customer_contact && (
                        <div className="mono text-[10px] text-mut">{r.customer_contact}</div>
                      )}
                    </td>
                    <td className="mono py-3 pr-4 text-[11px] uppercase">{r.seller_name ?? "—"}</td>
                    <td className="mono py-3 pr-4 text-[11px]">{r.pos ?? "—"}</td>
                    <td className="mono py-3 pr-4 text-[11px]">
                      {r.payment_method ?? "—"}
                      {r.installments ? (
                        <span className="text-mut"> · {r.installments} {r.installments === 1 ? "cuota" : "cuotas"}</span>
                      ) : null}
                      {Number(r.discount) > 0 && (
                        <span className="ml-1.5 text-acc">-{Math.round(Number(r.discount) * 100)}%</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-serif text-[17px]">{fmtARS(net)}</td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => toggle(r, "delivered")}
                          disabled={busy === r.id}
                          title="Alternar entregado"
                        >
                          <Chip tone={r.delivered ? "acc" : "default"}>
                            {r.delivered ? "Entregado" : "Pendiente"}
                          </Chip>
                        </button>
                        <button
                          onClick={() => toggle(r, "invoiced")}
                          disabled={busy === r.id}
                          title="Alternar factura"
                        >
                          <Chip tone="default">{r.invoiced ? "Facturado" : "Sin factura"}</Chip>
                        </button>
                        {r.invoice_path && (
                          <a
                            href={`/api/ventas/${r.id}/factura`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mono text-[10px] text-acc hover:underline"
                            title="Ver factura adjunta"
                          >
                            Factura ↗
                          </a>
                        )}
                        <span
                          className="flex items-center gap-1"
                          title={r.stock_deducted ? "Stock descontado en Shopify" : "No descuenta stock"}
                        >
                          <Dot alert={!r.stock_deducted && !r.is_other_brand} />
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      {role === "admin" && (
                        <button
                          onClick={() => remove(r)}
                          disabled={busy === r.id}
                          className={cn("mono text-[10px] text-mut hover:text-acc", busy === r.id && "opacity-40")}
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
