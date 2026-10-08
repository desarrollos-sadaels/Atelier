"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardTitle, Eyebrow, btnCls } from "@/components/ui";
import { Field, Textarea } from "@/components/forms";
import { ColorSwatch } from "@/components/ColorSwatch";
import { X } from "@/components/icons";
import { ProductPicker, type ChosenItem } from "../ProductPicker";
import type { PickerProduct } from "@/lib/queries";
import type { ExternalBrand } from "@/lib/external-brands";
import {
  DELIVERY_NOTE_TYPE_LABEL,
  deliveryNoteNumber,
  type DeliveryNoteType,
} from "@/lib/delivery-notes";
import { OperationTypePicker, type NewOperationType } from "./OperationTypePicker";

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function NuevoRemitoClient({
  products,
  brands,
  sellerName,
  type,
  onTypeChange,
}: {
  products: PickerProduct[];
  brands: ExternalBrand[];
  sellerName: string;
  type: Exclude<DeliveryNoteType, "delivery">;
  onTypeChange: (type: NewOperationType) => void;
}) {
  const router = useRouter();
  const [issuedAt, setIssuedAt] = useState(today());
  const [loanDueAt, setLoanDueAt] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ChosenItem[]>([]);
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price * (1 - item.discount) * item.qty, 0),
    [items],
  );
  const units = items.reduce((sum, item) => sum + item.qty, 0);
  const label = DELIVERY_NOTE_TYPE_LABEL[type];

  async function submit() {
    if (saving) return;
    if (!customerName.trim()) return toast.error("Ingresá el nombre del cliente");
    if (!items.length) return toast.error("Agregá al menos un ítem");

    const shortStock = type === "loan"
      ? items.filter(
          (item) => !item.isPreorder && item.available !== null && item.available < item.qty,
        )
      : [];
    if (shortStock.length) {
      const detail = shortStock
        .map((item) => `${item.article}: hay ${item.available}u y se prestan ${item.qty}`)
        .join("\n");
      if (!window.confirm(`Stock insuficiente:\n${detail}\n\n¿Emitir el préstamo igual?`)) return;
    }

    setSaving(true);
    const notification = toast.loading(`Creando ${label.toLowerCase()}…`);
    try {
      const response = await fetch("/api/remitos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          allowOversell: shortStock.length > 0,
          issuedAt,
          loanDueAt: type === "loan" ? loanDueAt || null : null,
          customerName,
          customerContact,
          customerAddress,
          notes,
          items: items.map((item) => ({
            productId: item.productId,
            inventoryItemId: item.inventoryItemId,
            variantGid: item.variantGid,
            article: item.article,
            color: item.color,
            talle: item.talle,
            qty: item.qty,
            unitPrice: item.price,
            discount: item.discount,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `No se pudo crear el ${label.toLowerCase()}`);

      toast.success(`${label} N.º ${deliveryNoteNumber(data.number)} creado`, { id: notification });
      if (data.warning) toast.warning(data.warning);
      router.push("/remitos");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : `No se pudo crear el ${label.toLowerCase()}`, {
        id: notification,
      });
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6 pb-1 pt-9 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Eyebrow className="mb-3">Ventas / Nueva operación</Eyebrow>
          <h1 className="font-serif text-[44px] leading-none tracking-tight">Crear {label.toLowerCase()}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3 pb-1">
          <OperationTypePicker value={type} onChange={onTypeChange} />
          <Link href="/remitos" className={btnCls("ghost")}>Cancelar</Link>
          <button
            type="button"
            className={btnCls("primary", !items.length ? "opacity-40" : undefined)}
            disabled={saving || !items.length}
            onClick={submit}
          >
            {saving ? "Guardando…" : `Crear ${label.toLowerCase()}`}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_460px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Ítems{items.length > 0 && ` · ${items.length} en el ${label.toLowerCase()}`}</CardTitle>
            <div className="px-6 pb-6 pt-4">
              {items.length > 0 && (
                <ul className="mb-5 border-t border-line">
                  {items.map((item) => (
                    <li key={item.key} className="flex items-center gap-3 border-b border-line py-3">
                      {item.color && <ColorSwatch name={item.color} size="sm" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">
                          {item.article}
                          {item.qty > 1 && <span className="mono ml-2 text-[11px] text-mut">×{item.qty}</span>}
                        </div>
                        <div className="mono text-[9px] uppercase text-mut2">
                          {[item.talle && `Talle ${item.talle}`, item.discount > 0 && `-${Math.round(item.discount * 100)}%`]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </div>
                      <span className="font-serif text-[16px]">
                        {ars.format(item.price * (1 - item.discount) * item.qty)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Quitar ${item.article}`}
                        className="grid h-6 w-6 place-items-center rounded-full text-mut hover:text-acc"
                        onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <ProductPicker
                products={products}
                brands={brands}
                onAdd={(item) => setItems((current) => [...current, item])}
              />

              {items.length === 0 && (
                <p className="mono mt-4 text-center text-[11px] text-mut">
                  Buscá una prenda y agregala al {label.toLowerCase()}.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Cliente</CardTitle>
            <div className="grid grid-cols-2 gap-4 px-6 pb-6 pt-4">
              <Field
                label="NOMBRE"
                placeholder="Nombre y apellido"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
              <Field
                label="MAIL O TELÉFONO"
                value={customerContact}
                onChange={(event) => setCustomerContact(event.target.value)}
              />
              <div className="col-span-2">
                <Field
                  label="DOMICILIO"
                  value={customerAddress}
                  onChange={(event) => setCustomerAddress(event.target.value)}
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Documento</CardTitle>
            <div className="grid grid-cols-2 gap-4 px-6 pb-6 pt-4">
              <Field
                label="FECHA"
                type="date"
                value={issuedAt}
                onChange={(event) => setIssuedAt(event.target.value)}
              />
              {type === "loan" && (
                <Field
                  label="DEVOLUCIÓN PREVISTA"
                  type="date"
                  value={loanDueAt}
                  onChange={(event) => setLoanDueAt(event.target.value)}
                />
              )}
              <div className="col-span-2">
                <Textarea
                  label="OBSERVACIONES"
                  rows={5}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
              {type === "loan" && (
                <p className="mono col-span-2 rounded-lg border border-line2 bg-panel px-4 py-3 text-[10px] leading-relaxed text-mut">
                  Al emitir el préstamo se descuenta el stock. Al marcarlo devuelto o anularlo, se repone automáticamente.
                </p>
              )}
              <div className="col-span-2 border-t border-line pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="mono text-[10px] text-mut">TOTAL · {units}u</span>
                  <span className="font-serif text-[28px] leading-none">{ars.format(total)}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Detalle</CardTitle>
            <div className="flex items-center justify-between px-6 pb-6 pt-4">
              <span className="mono text-[10px] text-mut">CREADO POR</span>
              <span className="mono text-[11px] uppercase">{sellerName}</span>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
