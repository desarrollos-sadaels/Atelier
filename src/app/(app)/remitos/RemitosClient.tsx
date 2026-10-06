"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import { Dropdown } from "@/components/Dropdown";
import { Field, Textarea } from "@/components/forms";
import { Chip, btnCls } from "@/components/ui";
import { Plus, X } from "@/components/icons";
import { ProductPicker, type ChosenItem } from "@/app/(app)/ventas/ProductPicker";
import type { PickerProduct } from "@/lib/queries";
import type { ExternalBrand } from "@/lib/external-brands";
import {
  DELIVERY_NOTE_STATUS_LABEL,
  DELIVERY_NOTE_TYPE_LABEL,
  deliveryNoteItemTotal,
  deliveryNoteNumber,
  type DeliveryNoteRow,
  type DeliveryNoteStatus,
  type DeliveryNoteType,
} from "@/lib/delivery-notes";

const TYPE_OPTIONS = ["Remito", "Préstamo", "Presupuesto"];

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function typeFromLabel(label: string): DeliveryNoteType {
  if (label === "Préstamo") return "loan";
  if (label === "Presupuesto") return "quote";
  return "delivery";
}

function statusTone(status: DeliveryNoteStatus): "default" | "acc" {
  return status === "issued" ? "acc" : "default";
}

export function RemitosClient({
  initialRows,
  products,
  brands,
  today,
}: {
  initialRows: DeliveryNoteRow[];
  products: PickerProduct[];
  brands: ExternalBrand[];
  today: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [previousRows, setPreviousRows] = useState(initialRows);
  const [open, setOpen] = useState(false);
  const [typeLabel, setTypeLabel] = useState("Remito");
  const [issuedAt, setIssuedAt] = useState(today);
  const [loanDueAt, setLoanDueAt] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ChosenItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  if (initialRows !== previousRows) {
    setPreviousRows(initialRows);
    setRows(initialRows);
  }

  const type = typeFromLabel(typeLabel);
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price * (1 - item.discount) * item.qty, 0),
    [items],
  );

  function startCreate() {
    setTypeLabel("Remito");
    setIssuedAt(today);
    setLoanDueAt("");
    setCustomerName("");
    setCustomerContact("");
    setCustomerAddress("");
    setNotes("");
    setItems([]);
    setOpen(true);
  }

  async function save() {
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
    const notification = toast.loading("Creando remito…");
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
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo crear el remito");
      toast.success(`${DELIVERY_NOTE_TYPE_LABEL[type]} N.º ${deliveryNoteNumber(data.number)} creado`, {
        id: notification,
      });
      if (data.warning) toast.warning(data.warning);
      setOpen(false);
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo crear el remito", {
        id: notification,
      });
    } finally {
      setSaving(false);
    }
  }

  async function closeNote(row: DeliveryNoteRow, status: "returned" | "cancelled") {
    if (updating) return;
    const verb = status === "returned" ? "marcar como devuelto" : "anular";
    if (!window.confirm(`¿Querés ${verb} el ${DELIVERY_NOTE_TYPE_LABEL[row.type].toLowerCase()} N.º ${deliveryNoteNumber(row.number)}?`)) return;
    setUpdating(row.id);
    try {
      const response = await fetch(`/api/remitos/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo actualizar");
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, status } : item));
      toast.success(status === "returned" ? "Préstamo devuelto y stock repuesto" : "Remito anulado");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo actualizar");
    } finally {
      setUpdating(null);
    }
  }

  return (
    <>
      <PageHeader
        kicker={`Documentos · ${rows.length}`}
        title="Remitos"
        actions={
          <button type="button" className={btnCls("primary")} onClick={startCreate}>
            <Plus className="h-4 w-4" /> Nuevo remito
          </button>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-10 grid place-items-center rounded-[4px] border border-dashed border-line py-20 text-center">
          <div className="font-serif text-[22px]">Todavía no hay remitos</div>
          <p className="mono mt-2 text-[11px] text-mut">Entregas, préstamos y presupuestos imprimibles.</p>
          <button type="button" className={btnCls("primary", "mt-5")} onClick={startCreate}>
            Crear el primero
          </button>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[980px] border-t border-line text-left">
            <thead>
              <tr className="mono text-[10px] text-mut">
                {["Número", "Fecha", "Tipo", "Cliente", "Ítems", "Total", "Estado", ""].map((heading) => (
                  <th key={heading} className="border-b border-line py-3 pr-4 font-normal">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowTotal = row.delivery_note_items.reduce(
                  (sum, item) => sum + deliveryNoteItemTotal(item),
                  0,
                );
                return (
                  <tr key={row.id} className="border-b border-line align-top hover:bg-panel/60">
                    <td className="mono py-4 pr-4 text-[11px]">{deliveryNoteNumber(row.number)}</td>
                    <td className="py-4 pr-4 text-[13px]">{new Date(`${row.issued_at}T12:00:00`).toLocaleDateString("es-AR")}</td>
                    <td className="py-4 pr-4 text-[13px] font-medium">{DELIVERY_NOTE_TYPE_LABEL[row.type]}</td>
                    <td className="py-4 pr-4">
                      <div className="text-[13px] font-medium">{row.customer_name}</div>
                      <div className="text-[11px] text-mut">{row.customer_contact ?? "—"}</div>
                    </td>
                    <td className="py-4 pr-4 text-[12px] text-ink2">
                      {row.delivery_note_items.reduce((sum, item) => sum + item.qty, 0)} u · {row.delivery_note_items.length} líneas
                    </td>
                    <td className="py-4 pr-4 font-serif text-[17px]">{ars.format(rowTotal)}</td>
                    <td className="py-4 pr-4"><Chip tone={statusTone(row.status)}>{DELIVERY_NOTE_STATUS_LABEL[row.status]}</Chip></td>
                    <td className="py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <a
                          href={`/remitos/${row.id}/imprimir`}
                          target="_blank"
                          rel="noreferrer"
                          className="mono text-[10px] text-ink hover:text-acc"
                        >
                          Imprimir
                        </a>
                        {row.type === "loan" && row.status === "issued" && (
                          <button
                            type="button"
                            disabled={updating === row.id}
                            onClick={() => closeNote(row, "returned")}
                            className="mono text-[10px] text-ink hover:text-acc disabled:opacity-40"
                          >
                            Devolver
                          </button>
                        )}
                        {row.status === "issued" && (
                          <button
                            type="button"
                            disabled={updating === row.id}
                            onClick={() => closeNote(row, "cancelled")}
                            className="mono text-[10px] text-acc hover:underline disabled:opacity-40"
                          >
                            Anular
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo documento"
        subtitle="Se guarda numerado y listo para imprimir"
        width="lg"
        footer={
          <>
            <button type="button" className={btnCls("ghost")} onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className={btnCls("primary")} disabled={saving} onClick={save}>
              {saving ? "Guardando…" : "Crear remito"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Dropdown label="TIPO" value={typeLabel} options={TYPE_OPTIONS} onChange={setTypeLabel} />
            <Field label="FECHA" type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
          </div>
          {type === "loan" && (
            <Field
              label="DEVOLUCIÓN PREVISTA"
              type="date"
              value={loanDueAt}
              onChange={(event) => setLoanDueAt(event.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="CLIENTE" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            <Field label="CONTACTO" value={customerContact} onChange={(event) => setCustomerContact(event.target.value)} />
          </div>
          <Field label="DIRECCIÓN" value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} />

          <ProductPicker products={products} brands={brands} onAdd={(item) => setItems((current) => [...current, item])} />

          {items.length > 0 && (
            <div className="border-t border-line">
              {items.map((item) => (
                <div key={item.key} className="flex items-center gap-3 border-b border-line py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{item.article}</div>
                    <div className="mono text-[9px] text-mut">
                      {[item.color, item.talle && `Talle ${item.talle}`, `${item.qty} u`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="font-serif text-[16px]">{ars.format(item.price * (1 - item.discount) * item.qty)}</div>
                  <button
                    type="button"
                    aria-label={`Quitar ${item.article}`}
                    className="text-mut hover:text-acc"
                    onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-baseline justify-between pt-4">
                <span className="mono text-[10px] text-mut">TOTAL</span>
                <span className="font-serif text-[26px]">{ars.format(total)}</span>
              </div>
            </div>
          )}

          <Textarea label="OBSERVACIONES" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
          {type === "loan" && (
            <p className="mono rounded-lg border border-line2 bg-panel px-4 py-3 text-[10px] leading-relaxed text-mut">
              Al emitir el préstamo se descuenta el stock. Al marcarlo devuelto o anularlo, se repone automáticamente.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
