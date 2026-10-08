"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Chip, btnCls } from "@/components/ui";
import { Plus } from "@/components/icons";
import {
  DELIVERY_NOTE_STATUS_LABEL,
  DELIVERY_NOTE_TYPE_LABEL,
  deliveryNoteItemTotal,
  deliveryNoteNumber,
  type DeliveryNoteRow,
  type DeliveryNoteStatus,
} from "@/lib/delivery-notes";

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function statusTone(status: DeliveryNoteStatus): "default" | "acc" {
  return status === "issued" ? "acc" : "default";
}

export function RemitosClient({
  initialRows,
}: {
  initialRows: DeliveryNoteRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [previousRows, setPreviousRows] = useState(initialRows);
  const [updating, setUpdating] = useState<string | null>(null);

  if (initialRows !== previousRows) {
    setPreviousRows(initialRows);
    setRows(initialRows);
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
        title="Documentos"
        actions={
          <Link href="/ventas/nueva?tipo=prestamo" className={btnCls("primary")}>
            <Plus className="h-4 w-4" /> Nuevo documento
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-10 grid place-items-center rounded-[4px] border border-dashed border-line py-20 text-center">
          <div className="font-serif text-[22px]">Todavía no hay documentos</div>
          <p className="mono mt-2 text-[11px] text-mut">Préstamos y presupuestos imprimibles.</p>
          <Link href="/ventas/nueva?tipo=prestamo" className={btnCls("primary", "mt-5")}>
            Crear el primero
          </Link>
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

    </>
  );
}
