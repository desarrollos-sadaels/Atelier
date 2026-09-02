"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Field, Textarea, ToggleRow } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { btnCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { PaymentMethod } from "@/lib/payments";
import type { Role } from "@/lib/roles";
import { normalizeOrigin, SALE_ORIGIN_LABEL } from "@/lib/sales";
import type { SaleWithItems, Seller } from "@/lib/queries";

const SIN_ASIGNAR = "— Sin asignar —";

/** Los canales por los que puede entrar una venta. */
export const PUNTOS_DE_VENTA = [
  "LOCAL",
  "SHOPIFY",
  "CHAT",
  "INSTAGRAM",
  "WHATSAPP",
  "FASHION X GLOBAL",
  "AMIGOS Y FAMILIA",
];

async function uploadInvoice(file: File): Promise<string> {
  const supabase = createClient();
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("invoices")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error(`No se pudo subir la factura: ${error.message}`);
  return path;
}

/**
 * Editar los datos comerciales de una venta.
 *
 * Existe sobre todo por las ventas que entran de Shopify: llegan sin vendedor,
 * con el canal en "SHOPIFY" y sin factura, aunque muchas las cerró alguien del
 * equipo por WhatsApp o Instagram y las cobró de otra forma. Esto es donde esa
 * venta se completa: quién la hizo, por dónde entró, cómo se pagó y la factura
 * adjunta.
 *
 * El artículo, la cantidad y la variante NO se editan acá: mover cualquiera de
 * esos desincronizaría el stock de Shopify sin un movimiento de inventario que
 * lo acompañe. Para eso están la devolución y el cambio.
 */
export function EditarVentaModal({
  sale,
  open,
  onClose,
  role,
  sellers,
  paymentMethods,
  currentUserId,
}: {
  sale: SaleWithItems;
  open: boolean;
  onClose: () => void;
  role: Role;
  sellers: Seller[];
  paymentMethods: PaymentMethod[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const origin = normalizeOrigin(sale.origin);

  const [sellerId, setSellerId] = useState<string | null>(sale.seller_id);
  const [pos, setPos] = useState(sale.pos ?? "LOCAL");
  const [pago, setPago] = useState(sale.payment_method ?? paymentMethods[0]?.name ?? "EFECTIVO");
  const [cuotas, setCuotas] = useState(sale.installments ? String(sale.installments) : "");
  const [custName, setCustName] = useState(sale.customer_name ?? "");
  const [custDni, setCustDni] = useState(sale.customer_dni ?? "");
  const [custContact, setCustContact] = useState(sale.customer_contact ?? "");
  const [custAddress, setCustAddress] = useState(sale.customer_address ?? "");
  const [delivered, setDelivered] = useState(sale.delivered);
  const [invoiced, setInvoiced] = useState(sale.invoiced);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [notes, setNotes] = useState(sale.notes ?? "");
  const [saleDiscount, setSaleDiscount] = useState(
    String(Math.round(Number(sale.sale_discount) * 100)),
  );
  const [saving, setSaving] = useState(false);

  const selectedMethod = paymentMethods.find((m) => m.name === pago) ?? null;
  const cuotaOptions = selectedMethod?.installments ?? [];

  // Un vendedor no puede asignarle la venta a otra persona (podría sacarse de
  // encima una propia o atribuírsela a un compañero). Sí puede quedársela, que
  // es el caso que importa: "esta venta de Shopify la hice yo".
  const canAssignOthers = role === "admin";
  // El precio de cada prenda no se edita acá: cambiarlo sin mover inventario
  // desincronizaría el stock. Lo único ajustable a nivel compra es el descuento
  // general ("te hago 10% por llevar dos").
  const canEditDiscount = role === "admin" && origin === "atelier";

  const sellerOptions = [SIN_ASIGNAR, ...sellers.map((s) => s.name)];
  const sellerLabel = sellerId ? (sellers.find((s) => s.id === sellerId)?.name ?? sale.seller_name ?? SIN_ASIGNAR) : SIN_ASIGNAR;

  const PAGOS = paymentMethods.map((m) => m.name);
  const posOptions = [...new Set([...PUNTOS_DE_VENTA, ...(sale.pos ? [sale.pos] : [])])];

  async function save() {
    if (saving) return;
    setSaving(true);
    const t = toast.loading("Guardando…");
    try {
      let invoicePath: string | undefined;
      if (invoiced && invoiceFile) {
        toast.loading("Subiendo factura…", { id: t });
        invoicePath = await uploadInvoice(invoiceFile);
      }

      const body: Record<string, unknown> = {
        pos,
        paymentMethod: pago,
        installments: cuotaOptions.length ? Math.trunc(Number(cuotas)) || cuotaOptions[0] : null,
        delivered,
        invoiced,
        notes: notes.trim() || null,
        customer: {
          name: custName.trim() || null,
          dni: custDni.trim() || null,
          contact: custContact.trim() || null,
          address: custAddress.trim() || null,
        },
      };
      if (invoicePath) body.invoicePath = invoicePath;

      // "Reclamar" y "asignar" son dos permisos distintos y el server los
      // distingue por el campo, no por el valor: `claim` no necesita ser admin.
      if (sellerId !== sale.seller_id) {
        if (sellerId && sellerId === currentUserId) body.claim = true;
        else body.sellerId = sellerId;
      }

      if (canEditDiscount) {
        const discountNum = (Number(saleDiscount) || 0) / 100;
        if (discountNum < 0 || discountNum >= 1) throw new Error("Descuento inválido (0–99%)");
        if (discountNum !== Number(sale.sale_discount)) body.saleDiscount = discountNum;
      }

      const res = await fetch(`/api/ventas/${sale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");

      toast.success("Venta actualizada", { id: t });
      onClose();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar", { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title="Editar venta"
      subtitle={
        <>
          {sale.sale_items.length}{" "}
          {sale.sale_items.length === 1 ? "prenda" : "prendas"} · {SALE_ORIGIN_LABEL[origin]}
          {sale.shopify_order_name && ` ${sale.shopify_order_name}`}
        </>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={btnCls("ghost")}>
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving} className={btnCls("primary")}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Dropdown
              label="VENDEDOR"
              value={sellerLabel}
              options={canAssignOthers ? sellerOptions : [sellerLabel, ...(currentUserId ? [sellers.find((s) => s.id === currentUserId)?.name ?? "Yo"] : [])].filter((v, i, a) => a.indexOf(v) === i)}
              onChange={(name) => {
                if (name === SIN_ASIGNAR) return setSellerId(null);
                setSellerId(sellers.find((s) => s.name === name)?.id ?? null);
              }}
            />
            {!sale.seller_id && currentUserId && sellerId !== currentUserId && (
              <button
                type="button"
                onClick={() => setSellerId(currentUserId)}
                className="mono mt-2 text-[10px] text-acc hover:underline"
              >
                Esta venta la hice yo →
              </button>
            )}
          </div>
          <Dropdown label="PUNTO DE VENTA" value={pos} options={posOptions} onChange={setPos} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Dropdown
            label="MEDIO DE PAGO"
            value={pago}
            options={PAGOS}
            onChange={(name) => {
              setPago(name);
              const m = paymentMethods.find((x) => x.name === name);
              setCuotas(m?.installments?.length ? String(m.installments[0]) : "");
            }}
          />
          {cuotaOptions.length > 0 && (
            <Dropdown
              label="CUOTAS"
              value={cuotas || String(cuotaOptions[0])}
              options={cuotaOptions.map(String)}
              onChange={setCuotas}
            />
          )}
        </div>

        {canEditDiscount && (
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="DESCUENTO GENERAL %"
              type="number"
              min={0}
              max={99}
              value={saleDiscount}
              onChange={(e) => setSaleDiscount(e.target.value)}
            />
            <p className="mono self-end pb-3 text-[10px] leading-relaxed text-mut">
              Se aplica sobre toda la compra, encima del descuento de cada prenda.
            </p>
          </div>
        )}
        {role === "admin" && origin === "shopify" && (
          <p className="mono text-[10px] text-mut">
            Los importes de una venta de Shopify los fija la tienda: se editan allá.
          </p>
        )}

        <div className="border-t border-line pt-5">
          <span className="mono text-[10px] text-mut">CLIENTE</span>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Field label="NOMBRE" value={custName} onChange={(e) => setCustName(e.target.value)} />
            <Field label="DNI" value={custDni} onChange={(e) => setCustDni(e.target.value)} />
            <Field
              label="CONTACTO"
              value={custContact}
              onChange={(e) => setCustContact(e.target.value)}
            />
            <Field
              label="DOMICILIO"
              value={custAddress}
              onChange={(e) => setCustAddress(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t border-line pt-2">
          <ToggleRow title="Entregado" on={delivered} onChange={setDelivered} />
          <ToggleRow
            title="Facturado"
            sub={sale.invoice_path ? "Ya tiene una factura adjunta" : undefined}
            on={invoiced}
            onChange={setInvoiced}
          />
          {invoiced && (
            <label className="mt-2 block">
              <span className="mono text-[10px] text-mut">
                {sale.invoice_path ? "REEMPLAZAR FACTURA (PDF O IMAGEN)" : "ADJUNTAR FACTURA (PDF O IMAGEN)"}
              </span>
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                className="mono mt-2 block w-full text-[11px] text-mut file:mr-3 file:rounded-full file:border file:border-line2 file:bg-bg file:px-3.5 file:py-1.5 file:text-[11px] file:text-ink hover:file:border-ink/40"
              />
            </label>
          )}
        </div>

        <Textarea label="NOTAS" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
