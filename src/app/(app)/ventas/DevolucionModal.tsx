"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Textarea } from "@/components/forms";
import { btnCls, Chip } from "@/components/ui";
import { ColorSwatch } from "@/components/ColorSwatch";
import { normalizeItemStatus, saleItemNet } from "@/lib/sales";
import type { SaleWithItems } from "@/lib/queries";
import { cn } from "@/lib/cn";

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/**
 * Devolver prendas de una compra.
 *
 * Arranca con todas las prendas activas tildadas, porque devolver la compra
 * entera es el caso más común; destildar deja una devolución parcial. Con una
 * sola prenda no hay nada que elegir y el selector no aparece.
 *
 * El diálogo dice las tres cosas que van a pasar antes de confirmar, porque las
 * tres son difíciles de deshacer: vuelve el stock a Shopify, el mes baja ese
 * importe, y la prenda queda marcada como devuelta en vez de desaparecer.
 */
export function DevolucionModal({
  sale,
  open,
  onClose,
}: {
  sale: SaleWithItems;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const active = sale.sale_items.filter((i) => normalizeItemStatus(i.status) === "active");
  const [selected, setSelected] = useState<Set<string>>(new Set(active.map((i) => i.id)));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const chosen = active.filter((i) => selected.has(i.id));
  const amount = chosen.reduce((s, i) => s + saleItemNet(i, sale.sale_discount), 0);
  const units = chosen.reduce((s, i) => s + i.qty, 0);
  const restocks = chosen.filter((i) => i.stock_deducted && i.product_id);
  const partial = chosen.length < active.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (saving) return;
    if (!chosen.length) return toast.error("Elegí al menos una prenda para devolver");

    setSaving(true);
    const t = toast.loading("Registrando devolución…");
    try {
      const res = await fetch(`/api/ventas/${sale.id}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim() || null,
          itemIds: chosen.map((i) => i.id),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo registrar la devolución");

      if (data.warning) {
        toast.warning("Devolución registrada, con una advertencia", {
          id: t,
          description: data.warning,
          duration: 12000,
        });
      } else {
        toast.success(
          data.returned === 1 ? "Devolución registrada" : `${data.returned} prendas devueltas`,
          {
            id: t,
            description: data.restocked
              ? `${data.restocked === 1 ? "1 prenda repuesta" : `${data.restocked} prendas repuestas`} en Shopify.`
              : "Sin stock que reponer en Shopify.",
          },
        );
      }
      onClose();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo registrar la devolución", { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar devolución"
      subtitle={
        sale.customer_name
          ? `${sale.customer_name} · ${active.length} ${active.length === 1 ? "prenda activa" : "prendas activas"}`
          : `${active.length} ${active.length === 1 ? "prenda activa" : "prendas activas"}`
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={btnCls("ghost")}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !chosen.length}
            className={btnCls("primary", !chosen.length ? "opacity-40" : undefined)}
          >
            {saving ? "Registrando…" : partial ? `Devolver ${chosen.length}` : "Devolver todo"}
          </button>
        </>
      }
    >
      {active.length > 1 && (
        <div className="mb-5">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] text-mut">QUÉ PRENDAS VUELVEN</span>
            <button
              type="button"
              onClick={() =>
                setSelected(
                  chosen.length === active.length ? new Set() : new Set(active.map((i) => i.id)),
                )
              }
              className="mono text-[10px] text-mut hover:text-ink"
            >
              {chosen.length === active.length ? "Ninguna" : "Todas"}
            </button>
          </div>
          <ul className="mt-2 border-t border-line">
            {active.map((item) => {
              const on = selected.has(item.id);
              return (
                <li key={item.id} className="border-b border-line">
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[10px] text-white",
                        on ? "border-ink bg-ink" : "border-line2",
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                    {item.color && <ColorSwatch name={item.color} size="sm" />}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[13px]", !on && "text-mut")}>
                        {item.article}
                        {item.qty > 1 && (
                          <span className="mono ml-1.5 text-[10px] text-mut">×{item.qty}</span>
                        )}
                      </span>
                      <span className="mono block text-[9px] uppercase text-mut2">
                        {[item.talle && `Talle ${item.talle}`, !item.stock_deducted && "sin stock que reponer"]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </span>
                    <span className={cn("font-serif text-[14px]", !on && "text-mut")}>
                      {arsFmt.format(saleItemNet(item, sale.sale_discount))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ul className="space-y-2.5 text-[13px]">
        <li className="flex items-start gap-2.5">
          <span className="mono mt-0.5 text-[11px] text-mut">1</span>
          <span>
            {restocks.length ? (
              <>
                Vuelven <strong>{units}u</strong> al stock de Shopify.
              </>
            ) : (
              <span className="text-mut">
                No hay stock que reponer (estas prendas no descontaron inventario).
              </span>
            )}
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="mono mt-0.5 text-[11px] text-mut">2</span>
          <span>
            El mes deja de contar <strong>{arsFmt.format(amount)}</strong>.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="mono mt-0.5 text-[11px] text-mut">3</span>
          <span className="text-mut">
            {partial ? (
              <>
                La compra sigue activa por{" "}
                <strong className="text-ink">
                  {active.length - chosen.length}{" "}
                  {active.length - chosen.length === 1 ? "prenda" : "prendas"}
                </strong>
                , con las devueltas marcadas <Chip tone="acc">Devuelta</Chip>.
              </>
            ) : (
              <>
                La compra queda marcada como <strong className="text-ink">Devuelta</strong>, no se
                borra: así el reporte puede explicar por qué el mes cerró más bajo.
              </>
            )}
          </span>
        </li>
      </ul>

      <div className="mt-5">
        <Textarea
          label="MOTIVO (OPCIONAL)"
          placeholder="Talle equivocado, falla, arrepentimiento…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}
