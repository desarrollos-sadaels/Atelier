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
import {
  WHOLESALE_FULFILLMENT_LABEL,
  WHOLESALE_FULFILLMENT_OPTIONS,
  WHOLESALE_POS,
  isWholesaleFulfillmentMethod,
  wholesaleFulfillmentFromLabel,
  type WholesaleFulfillmentMethod,
  type WholesaleSettings,
} from "@/lib/wholesale";
import type { SaleWithItems, Seller } from "@/lib/queries";

const SIN_ASIGNAR = "— Sin asignar —";
const SIN_TIENDA_MAYORISTA = "— Seleccionar tienda —";

/** Los canales por los que puede entrar una venta. */
export const PUNTOS_DE_VENTA = [
  "LOCAL",
  "SHOPIFY",
  "CHAT",
  "INSTAGRAM",
  "WHATSAPP",
  "FASHION X GLOBAL",
  "AMIGOS Y FAMILIA",
  // El reporte cuenta este punto de venta como canal aparte (ver `saleChannel`).
  WHOLESALE_POS,
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
  wholesaleSettings,
  currentUserId,
}: {
  sale: SaleWithItems;
  open: boolean;
  onClose: () => void;
  role: Role;
  sellers: Seller[];
  paymentMethods: PaymentMethod[];
  wholesaleSettings: WholesaleSettings;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const origin = normalizeOrigin(sale.origin);

  const [sellerId, setSellerId] = useState<string | null>(sale.seller_id);
  const [pos, setPos] = useState(sale.pos ?? "LOCAL");
  const [wholesaleStore, setWholesaleStore] = useState(sale.wholesale_store ?? "");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<WholesaleFulfillmentMethod>(
    isWholesaleFulfillmentMethod(sale.fulfillment_method)
      ? sale.fulfillment_method
      : Number(sale.shipping_amount) > 0
        ? "shipping"
        : "pickup",
  );
  const [pago, setPago] = useState(sale.payment_method ?? paymentMethods[0]?.name ?? "EFECTIVO");
  const [cuotas, setCuotas] = useState(sale.installments ? String(sale.installments) : "");
  const [custName, setCustName] = useState(sale.customer_name ?? "");
  const [custDni, setCustDni] = useState(sale.customer_dni ?? "");
  const [custContact, setCustContact] = useState(sale.customer_contact ?? "");
  const [custAddress, setCustAddress] = useState(sale.customer_address ?? "");
  const [delivered, setDelivered] = useState(sale.delivered);
  const [preorder, setPreorder] = useState(sale.preorder);
  const [invoiced, setInvoiced] = useState(sale.invoiced);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [notes, setNotes] = useState(sale.notes ?? "");
  const [saleDiscount, setSaleDiscount] = useState(
    String(Math.round(Number(sale.sale_discount) * 100)),
  );
  const [shippingAmount, setShippingAmount] = useState(String(Number(sale.shipping_amount) || 0));
  const [saving, setSaving] = useState(false);

  const selectedMethod = paymentMethods.find((m) => m.name === pago) ?? null;
  const cuotaOptions = selectedMethod?.installments ?? [];
  const isWholesale = pos.trim().toUpperCase() === WHOLESALE_POS;
  const wasWholesale = sale.pos?.trim().toUpperCase() === WHOLESALE_POS;

  // Un vendedor no puede asignarle la venta a otra persona (podría sacarse de
  // encima una propia o atribuírsela a un compañero). Sí puede quedársela, que
  // es el caso que importa: "esta venta de Shopify la hice yo".
  const canAssignOthers = role === "admin";
  // El precio de cada prenda no se edita acá: cambiarlo sin mover inventario
  // desincronizaría el stock. Lo único ajustable a nivel compra es el descuento
  // general ("te hago 10% por llevar dos").
  const canEditDiscount = role === "admin" && origin === "atelier" && !isWholesale;

  const sellerOptions = [SIN_ASIGNAR, ...sellers.map((s) => s.name)];
  const sellerLabel = sellerId ? (sellers.find((s) => s.id === sellerId)?.name ?? sale.seller_name ?? SIN_ASIGNAR) : SIN_ASIGNAR;

  const PAGOS = paymentMethods.map((m) => m.name);
  // Una venta existente no se convierte a mayorista desde este modal: al
  // crearla se fija el PVP de cada prenda. Por la misma razón, una mayorista
  // tampoco se reclasifica como común: conserva su tipo y permite corregir
  // únicamente sus datos administrativos.
  const allowedPoints = wasWholesale
    ? [WHOLESALE_POS]
    : PUNTOS_DE_VENTA.filter((point) => point !== WHOLESALE_POS);
  const posOptions = [...new Set([...allowedPoints, ...(sale.pos ? [sale.pos] : [])])];
  const wholesaleStoreOptions = [
    SIN_TIENDA_MAYORISTA,
    ...wholesaleSettings.stores,
    ...(sale.wholesale_store && !wholesaleSettings.stores.includes(sale.wholesale_store)
      ? [sale.wholesale_store]
      : []),
  ];

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
        preorder,
        invoiced,
        notes: notes.trim() || null,
        customer: {
          name: custName.trim() || null,
          dni: custDni.trim() || null,
          contact: custContact.trim() || null,
          address: custAddress.trim() || null,
        },
      };
      if (isWholesale) {
        if (!wholesaleStore) throw new Error("Elegí la tienda mayorista");
        body.wholesaleStore = wholesaleStore;
        body.fulfillmentMethod = fulfillmentMethod;
      }
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
      if (origin === "atelier") {
        const shipping = isWholesale && fulfillmentMethod === "pickup"
          ? 0
          : Number(shippingAmount) || 0;
        if (!Number.isFinite(shipping) || shipping < 0) throw new Error("Costo de envío inválido");
        if (isWholesale && fulfillmentMethod === "shipping" && shipping <= 0) {
          throw new Error("Ingresá el costo de envío que paga el comprador");
        }
        if (shipping !== Number(sale.shipping_amount)) body.shippingAmount = shipping;
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

        {isWholesale && (
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-line2 bg-panel p-4">
            <Dropdown
              label="TIENDA MAYORISTA"
              value={wholesaleStore || SIN_TIENDA_MAYORISTA}
              options={wholesaleStoreOptions}
              onChange={(value) =>
                setWholesaleStore(value === SIN_TIENDA_MAYORISTA ? "" : value)
              }
            />
            <Dropdown
              label="ENTREGA"
              value={WHOLESALE_FULFILLMENT_LABEL[fulfillmentMethod]}
              options={WHOLESALE_FULFILLMENT_OPTIONS}
              onChange={(label) => {
                const next = wholesaleFulfillmentFromLabel(label);
                setFulfillmentMethod(next);
                if (next === "pickup") setShippingAmount("0");
              }}
            />
            <p className="col-span-2 text-[12px] text-mut">
              Esta venta conserva el descuento mayorista aplicado al registrarse. El envío se
              cobra al comprador; el retiro presencial no suma costo.
            </p>
          </div>
        )}

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

        {origin === "atelier" && (
          <div className="grid grid-cols-2 gap-4">
            {canEditDiscount && (
              <Field
                label="DESCUENTO GENERAL %"
                type="number"
                min={0}
                max={99}
                value={saleDiscount}
                onChange={(e) => setSaleDiscount(e.target.value)}
              />
            )}
            <Field
              label={isWholesale && fulfillmentMethod === "shipping"
                ? "COSTO DE ENVÍO · A CARGO DEL COMPRADOR"
                : "COSTO DE ENVÍO"}
              type="number"
              min={0}
              value={shippingAmount}
              disabled={isWholesale && fulfillmentMethod === "pickup"}
              onChange={(e) => setShippingAmount(e.target.value)}
            />
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
          <ToggleRow
            title="Preventa"
            sub="La prenda todavía no está: la compra figura como esperando entrega"
            on={preorder}
            onChange={(on) => {
              setPreorder(on);
              // Marcarla como preventa la deja esperando mercadería; darla por
              // entregada no borra que lo fue, que es como quedó registrada.
              if (on) setDelivered(false);
            }}
          />
          <ToggleRow
            title="Entregado"
            sub={preorder && !delivered ? "Marcalo cuando llegue la prenda" : undefined}
            on={delivered}
            onChange={setDelivered}
          />
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
