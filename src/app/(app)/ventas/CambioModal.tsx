"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Dropdown } from "@/components/Dropdown";
import { btnCls } from "@/components/ui";
import { X } from "@/components/icons";
import { exchangeBalance, saleItemNet, saleNet } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";
import { ProductPicker, type ChosenItem } from "./ProductPicker";
import type { PickerProduct, SaleItemRow, SaleWithItems } from "@/lib/queries";
import { cn } from "@/lib/cn";

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/**
 * Cambiar una prenda por otra(s).
 *
 * La regla de plata se muestra en pantalla porque no es evidente y es la que
 * el vendedor tiene que poder explicarle al cliente: **el importe de la venta
 * original nunca baja**. Si lo nuevo sale más caro, el cliente paga la
 * diferencia; si sale más barato, el sobrante queda a favor del negocio y no se
 * devuelve plata.
 */
export function CambioModal({
  sale,
  item,
  open,
  onClose,
  paymentMethods,
}: {
  sale: SaleWithItems;
  /** La prenda que vuelve. El cambio es por prenda, no por compra. */
  item: SaleItemRow;
  open: boolean;
  onClose: () => void;
  paymentMethods: PaymentMethod[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<ChosenItem[]>([]);
  // El catálogo se pide al abrir el diálogo, no en el render de `/ventas`: son
  // 404 productos que la mayoría de las visitas al listado no necesita.
  const [products, setProducts] = useState<PickerProduct[] | null>(null);
  const [pago, setPago] = useState(sale.payment_method ?? paymentMethods[0]?.name ?? "EFECTIVO");
  const [saving, setSaving] = useState(false);

  // Las dos puntas se cotizan con el descuento general de la compra aplicado:
  // la prenda que vuelve valía eso, y la nueva entra en la misma compra. Comparar
  // una con promo contra otra sin promo le cobraría al cliente una diferencia
  // que no existe.
  const originalNet = saleItemNet(item, sale.sale_discount);
  const replacementNet = useMemo(
    () => items.reduce((s, it) => s + saleItemNet(it, sale.sale_discount), 0),
    [items, sale.sale_discount],
  );
  const balance = exchangeBalance(originalNet, replacementNet);

  const shortStock = items.filter((it) => it.available !== null && it.available < it.qty);

  useEffect(() => {
    if (!open || products) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/products/picker");
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo cargar el catálogo");
        if (!cancelled) setProducts(data.products ?? []);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "No se pudo cargar el catálogo");
          setProducts([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, products]);

  async function submit() {
    if (saving) return;
    if (!items.length) return toast.error("Elegí al menos una prenda para el cambio");

    if (shortStock.length) {
      const detail = shortStock
        .map((it) => `${it.article}: hay ${it.available}u y se llevan ${it.qty}`)
        .join("\n");
      if (!window.confirm(`Stock insuficiente:\n${detail}\n\n¿Registrar el cambio igual?`)) return;
    }

    setSaving(true);
    const t = toast.loading("Registrando cambio…");
    try {
      const res = await fetch(`/api/ventas/${sale.id}/cambio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          allowOversell: shortStock.length > 0,
          differencePaymentMethod: balance.toCharge > 0 ? pago : null,
          items: items.map((it) => ({
            productId: it.productId,
            inventoryItemId: it.inventoryItemId,
            variantGid: it.variantGid,
            article: it.article,
            color: it.color,
            talle: it.talle,
            brand: it.brand,
            isOtherBrand: it.isOtherBrand,
            qty: it.qty,
            price: it.price,
            discount: it.discount,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo registrar el cambio");

      const detail =
        data.charged > 0
          ? `El cliente paga ${arsFmt.format(data.charged)} de diferencia.`
          : data.surplus > 0
            ? `Quedan ${arsFmt.format(data.surplus)} a favor del negocio.`
            : "Sin diferencia de precio.";
      if (data.warning) {
        toast.warning("Cambio registrado, con una advertencia", {
          id: t,
          description: data.warning,
          duration: 12000,
        });
      } else {
        toast.success("Cambio registrado", { id: t, description: detail });
      }
      setItems([]);
      onClose();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo registrar el cambio", { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title="Registrar cambio"
      subtitle={`Devuelve: ${item.article}${item.qty > 1 ? ` ×${item.qty}` : ""} · ${arsFmt.format(originalNet)}`}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnCls("ghost")}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !items.length}
            className={btnCls("primary", !items.length ? "opacity-40" : undefined)}
          >
            {saving ? "Registrando…" : "Confirmar cambio"}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        Vuelven <strong className="text-ink">{item.qty}u</strong> de{" "}
        <strong className="text-ink">{item.article}</strong> al stock, y en su lugar se suman a esta
        misma compra las prendas que elijas acá abajo.
      </p>

      {items.length > 0 && (
        <ul className="mt-4 border-t border-line">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-3 border-b border-line py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {it.article}
                  {it.qty > 1 && <span className="mono ml-1.5 text-[11px] text-mut">×{it.qty}</span>}
                </div>
                <div className="mono text-[10px] uppercase text-mut2">
                  {[it.color, it.talle && `Talle ${it.talle}`, it.isOtherBrand && (it.brand ?? "otra marca")]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                  {it.discount > 0 && (
                    <span className="ml-1.5 text-acc">-{Math.round(it.discount * 100)}%</span>
                  )}
                  {it.available !== null && it.available < it.qty && (
                    <span className="ml-1.5 text-acc">· stock {it.available}u</span>
                  )}
                </div>
              </div>
              <span className="font-serif text-[15px]">{arsFmt.format(saleNet(it))}</span>
              <button
                type="button"
                aria-label={`Quitar ${it.article}`}
                onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                className="rounded-full p-1 text-mut hover:text-acc"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {products === null ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-line py-10">
            <span className="mono text-[11px] text-mut">Cargando catálogo…</span>
          </div>
        ) : (
          <ProductPicker products={products} onAdd={(it) => setItems((prev) => [...prev, it])} />
        )}
      </div>

      {items.length > 0 && (
        <div className="mt-5 rounded-lg border border-line2 bg-panel/50 p-4">
          <Row label="Prenda que vuelve" value={arsFmt.format(originalNet)} />
          <Row label="Prendas nuevas" value={arsFmt.format(replacementNet)} />
          <div className="mt-3 border-t border-line pt-3">
            {balance.toCharge > 0 ? (
              <Row
                label="El cliente paga"
                value={arsFmt.format(balance.toCharge)}
                strong
                tone="acc"
              />
            ) : balance.surplus > 0 ? (
              <>
                <Row label="A favor del negocio" value={arsFmt.format(balance.surplus)} strong />
                <p className="mono mt-2 text-[10px] leading-relaxed text-mut">
                  No se devuelve plata: la venta sigue facturando {arsFmt.format(originalNet)} y el
                  mes no baja.
                </p>
              </>
            ) : (
              <Row label="Sin diferencia" value="—" strong />
            )}
          </div>

          {balance.toCharge > 0 && (
            <div className="mt-4">
              <Dropdown
                label="CÓMO PAGA LA DIFERENCIA"
                value={pago}
                options={paymentMethods.map((m) => m.name)}
                onChange={setPago}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "acc";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="mono text-[11px] text-mut">{label}</span>
      <span
        className={cn(
          strong ? "font-serif text-[20px]" : "text-[13px]",
          tone === "acc" && "text-acc",
        )}
      >
        {value}
      </span>
    </div>
  );
}
