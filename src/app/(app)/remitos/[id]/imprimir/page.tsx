import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/queries";
import { getDeliveryNote } from "@/lib/delivery-notes-server";
import { isAuthEnabled } from "@/lib/supabase/config";
import { ROLE_HOME } from "@/lib/roles";
import {
  DELIVERY_NOTE_STATUS_LABEL,
  DELIVERY_NOTE_TYPE_LABEL,
  deliveryNoteItemTotal,
  deliveryNoteNumber,
} from "@/lib/delivery-notes";
import { btnCls } from "@/components/ui";
import { PrintButton } from "./PrintButton";
import styles from "./print.module.css";

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export default async function PrintDeliveryNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (isAuthEnabled()) {
    if (!profile) redirect("/login");
    if (profile.role === "medios") redirect(ROLE_HOME.medios);
  }

  const note = await getDeliveryNote(id);
  if (!note) notFound();

  const total = note.delivery_note_items.reduce(
    (sum, item) => sum + deliveryNoteItemTotal(item),
    0,
  );

  return (
    <div className={styles.page}>
      <div className={styles.actions}>
        <a href="/remitos" className={btnCls("ghost", "h-10")}>Volver</a>
        <PrintButton className={btnCls("primary", "h-10")} />
      </div>

      <article className={styles.sheet}>
        <div className="flex items-start justify-between gap-8 border-b-2 border-ink pb-8">
          <div>
            <div className="font-serif text-[34px] font-semibold tracking-tight">Sadaels</div>
            <div className="mono mt-1 text-[10px] text-mut">ATELIER · DOCUMENTO NO FISCAL</div>
          </div>
          <div className="text-right">
            <div className="font-serif text-[30px]">{DELIVERY_NOTE_TYPE_LABEL[note.type]}</div>
            <div className="mono mt-2 text-[12px]">N.º {deliveryNoteNumber(note.number)}</div>
            <div className="mt-1 text-[12px] text-mut">
              {new Date(`${note.issued_at}T12:00:00`).toLocaleDateString("es-AR")}
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-5 border-b border-line pb-8">
          <div>
            <div className="mono text-[9px] text-mut">CLIENTE</div>
            <div className="mt-1 text-[15px] font-semibold">{note.customer_name}</div>
          </div>
          <div>
            <div className="mono text-[9px] text-mut">CONTACTO</div>
            <div className="mt-1 text-[14px]">{note.customer_contact ?? "—"}</div>
          </div>
          <div className="col-span-2">
            <div className="mono text-[9px] text-mut">DIRECCIÓN</div>
            <div className="mt-1 text-[14px]">{note.customer_address ?? "—"}</div>
          </div>
          {note.type === "loan" && (
            <div>
              <div className="mono text-[9px] text-mut">DEVOLUCIÓN PREVISTA</div>
              <div className="mt-1 text-[14px]">
                {note.loan_due_at
                  ? new Date(`${note.loan_due_at}T12:00:00`).toLocaleDateString("es-AR")
                  : "A coordinar"}
              </div>
            </div>
          )}
          <div>
            <div className="mono text-[9px] text-mut">ESTADO</div>
            <div className="mt-1 text-[14px]">{DELIVERY_NOTE_STATUS_LABEL[note.status]}</div>
          </div>
        </div>

        <table className="mt-9 w-full border-collapse text-left">
          <thead>
            <tr className="mono border-b border-ink text-[9px] text-mut">
              <th className="py-3 pr-3 font-normal">CANT.</th>
              <th className="py-3 pr-3 font-normal">ARTÍCULO</th>
              <th className="py-3 pr-3 font-normal">COLOR</th>
              <th className="py-3 pr-3 font-normal">TALLE</th>
              <th className="py-3 pr-3 text-right font-normal">UNITARIO</th>
              <th className="py-3 text-right font-normal">IMPORTE</th>
            </tr>
          </thead>
          <tbody>
            {note.delivery_note_items.map((item) => (
              <tr key={item.id} className="border-b border-line text-[13px]">
                <td className="py-4 pr-3">{item.qty}</td>
                <td className="py-4 pr-3 font-medium">{item.article}</td>
                <td className="py-4 pr-3">{item.color ?? "—"}</td>
                <td className="py-4 pr-3">{item.talle ?? "—"}</td>
                <td className="py-4 pr-3 text-right">{ars.format(Number(item.unit_price))}</td>
                <td className="py-4 text-right font-medium">{ars.format(deliveryNoteItemTotal(item))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-7 flex max-w-[310px] items-baseline justify-between border-t border-ink pt-4">
          <span className="mono text-[10px] text-mut">TOTAL</span>
          <span className="font-serif text-[28px]">{ars.format(total)}</span>
        </div>

        {note.notes && (
          <div className="mt-10 rounded-[4px] border border-line p-5">
            <div className="mono text-[9px] text-mut">OBSERVACIONES</div>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed">{note.notes}</p>
          </div>
        )}

        <div className="mt-24 grid grid-cols-2 gap-16 text-center">
          <div className="border-t border-ink pt-3">
            <div className="mono text-[9px] text-mut">ENTREGADO POR</div>
            <div className="mt-1 text-[12px]">{note.created_by_name ?? "Atelier"}</div>
          </div>
          <div className="border-t border-ink pt-3">
            <div className="mono text-[9px] text-mut">RECIBÍ CONFORME</div>
            <div className="mt-1 text-[12px]">Firma y aclaración</div>
          </div>
        </div>

        <p className="mono mt-16 text-center text-[8px] leading-relaxed text-mut">
          {note.type === "quote"
            ? "Presupuesto sujeto a disponibilidad y confirmación."
            : note.type === "loan"
              ? "Las prendas detalladas se entregan en carácter de préstamo y deben devolverse en el estado recibido."
              : "Constancia de entrega de los artículos detallados."}
        </p>
      </article>
    </div>
  );
}

