"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardTitle, Eyebrow, btnCls } from "@/components/ui";
import { Field, Textarea, Toggle } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { ColorSwatch } from "@/components/ColorSwatch";
import { X } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import type { PaymentMethod } from "@/lib/payments";
import type { PickerProduct } from "@/lib/queries";
import { saleItemNet, saleNet } from "@/lib/sales";
import { cn } from "@/lib/cn";
import { ProductPicker, type ChosenItem } from "../ProductPicker";

export type { PickerProduct } from "@/lib/queries";

const PUNTOS = ["LOCAL", "SHOPIFY", "CHAT", "INSTAGRAM", "WHATSAPP", "FASHION X GLOBAL", "AMIGOS Y FAMILIA"];

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

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Registrar una venta: UNA compra con las prendas que se lleve el cliente.
 *
 * Antes este formulario cargaba exactamente un producto, así que una compra de
 * dos prendas había que registrarla como dos ventas — con el cliente, el medio
 * de pago y la factura duplicados, y el ticket promedio del reporte a la mitad.
 * Ahora la pantalla es un carrito: se agregan prendas y el pago es uno solo.
 */
export function NuevaVentaClient({
  products,
  sellerName,
  paymentMethods,
}: {
  products: PickerProduct[];
  sellerName: string;
  paymentMethods: PaymentMethod[];
}) {
  const router = useRouter();
  const PAGOS = paymentMethods.map((m) => m.name);

  const [items, setItems] = useState<ChosenItem[]>([]);
  // cliente
  const [custName, setCustName] = useState("");
  const [custDni, setCustDni] = useState("");
  const [custContact, setCustContact] = useState("");
  const [custAddress, setCustAddress] = useState("");
  // pago
  const [soldAt, setSoldAt] = useState(today());
  const [saleDiscount, setSaleDiscount] = useState("0");
  const [pago, setPago] = useState(paymentMethods[0]?.name ?? "EFECTIVO");
  const [cuotas, setCuotas] = useState("");
  const [punto, setPunto] = useState("LOCAL");
  const [invoiced, setInvoiced] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [delivered, setDelivered] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Se genera recién en el primer submit (no en render) para no depender de
  // `crypto` durante el SSR.
  const idempotencyKey = useRef<string | null>(null);
  // Firma de los datos del último intento: si el usuario corrige algo antes de
  // reintentar, la clave vieja ya no debe reusarse (si no, el server devolvería
  // la venta original con los datos viejos como si el reintento hubiese sido
  // exitoso, y la corrección se pierde en silencio).
  const lastSignature = useRef<string | null>(null);
  // Path de la factura ya subida para ESTE intento. Sin esto, un reintento con
  // los mismos datos volvía a subir el archivo con un UUID nuevo y, como la
  // clave de idempotencia no cambiaba, el server devolvía la venta original: el
  // segundo archivo quedaba huérfano en el bucket.
  const uploadedInvoice = useRef<string | null>(null);

  const selectedMethod = paymentMethods.find((m) => m.name === pago) ?? null;
  const cuotaOptions = selectedMethod?.installments ?? [];
  const showCuotas = cuotaOptions.length > 0;

  function changePago(name: string) {
    setPago(name);
    const m = paymentMethods.find((x) => x.name === name);
    setCuotas(m?.installments?.length ? String(m.installments[0]) : "");
  }

  const discountFraction = (Number(saleDiscount) || 0) / 100;
  const subtotal = useMemo(() => items.reduce((s, it) => s + saleNet(it), 0), [items]);
  const total = useMemo(
    () => items.reduce((s, it) => s + saleItemNet(it, discountFraction), 0),
    [items, discountFraction],
  );
  const units = items.reduce((s, it) => s + it.qty, 0);

  async function submit() {
    if (saving) return;
    if (!items.length) return toast.error("Agregá al menos una prenda");
    if (discountFraction < 0 || discountFraction >= 1) {
      return toast.error("Descuento general inválido (0–99%)");
    }

    // El server revalida contra Shopify. Este flag le dice que el faltante ya
    // se vio y se aceptó, para que no lo reporte como hallazgo.
    const short = items.filter((it) => it.available !== null && it.available < it.qty);
    if (short.length) {
      const detail = short
        .map((it) => `${it.article}: hay ${it.available}u y se venden ${it.qty}`)
        .join("\n");
      if (!window.confirm(`Stock insuficiente:\n${detail}\n\n¿Registrar la venta igual?`)) return;
    }

    setSaving(true);
    const t = toast.loading("Registrando venta…");
    try {
      // Clave de idempotencia: se genera una vez y se reusa en los reintentos
      // de ESTA venta. Si la request se duplica (doble tap, retry del browser,
      // respuesta perdida), el server devuelve la venta original en vez de
      // registrarla de nuevo y descontar stock dos veces.
      const signature = JSON.stringify({
        soldAt, saleDiscount, pago, cuotas, punto, invoiced, delivered, notes,
        custName, custDni, custContact, custAddress,
        items: items.map((it) => [it.article, it.qty, it.price, it.discount, it.variantGid]),
        invoiceFile: invoiceFile ? `${invoiceFile.name}:${invoiceFile.size}:${invoiceFile.lastModified}` : null,
      });
      if (idempotencyKey.current && lastSignature.current !== signature) {
        idempotencyKey.current = null;
        uploadedInvoice.current = null;
      }
      lastSignature.current = signature;
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

      let invoicePath: string | undefined;
      if (invoiced && invoiceFile) {
        if (!uploadedInvoice.current) {
          toast.loading("Subiendo factura…", { id: t });
          uploadedInvoice.current = await uploadInvoice(invoiceFile);
        }
        invoicePath = uploadedInvoice.current;
      }

      const res = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          allowOversell: short.length > 0,
          soldAt,
          saleDiscount: discountFraction,
          paymentMethod: pago,
          installments: showCuotas ? Math.trunc(Number(cuotas)) || cuotaOptions[0] : undefined,
          pos: punto,
          invoiced,
          invoicePath,
          delivered,
          notes: notes.trim() || undefined,
          customer: {
            name: custName.trim() || undefined,
            dni: custDni.trim() || undefined,
            contact: custContact.trim() || undefined,
            address: custAddress.trim() || undefined,
          },
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
      if (!res.ok || !data.ok) throw new Error(data.error || "Error registrando la venta");

      // Un warning significa que algo quedó a medias (stock sin descontar, sin
      // marcar, o en negativo). En verde se lee como "todo bien" y se pasa por
      // alto justo en el aviso que hay que atender.
      if (data.warning) {
        toast.warning("Venta registrada, con una advertencia", {
          id: t,
          description: data.warning,
          duration: 12000,
        });
      } else {
        toast.success("Venta registrada", {
          id: t,
          description: data.stockDeducted ? "Stock descontado en Shopify." : undefined,
        });
      }
      router.push("/ventas");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error registrando la venta", { id: t });
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-end justify-between gap-6 pt-9 pb-1">
        <div>
          <Eyebrow className="mb-3">Ventas / Registrar venta</Eyebrow>
          <h1 className="font-serif text-[44px] leading-none tracking-tight">Registrar venta</h1>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <Link href="/ventas" className={btnCls("ghost")}>
            Cancelar
          </Link>
          <button
            className={btnCls("primary", !items.length ? "opacity-40" : undefined)}
            disabled={saving || !items.length}
            onClick={submit}
          >
            {saving ? "Guardando…" : "Registrar venta"}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_460px]">
        {/* columna principal */}
        <div className="space-y-6">
          <Card>
            <CardTitle>
              Prendas{items.length > 0 && ` · ${items.length} en la venta`}
            </CardTitle>
            <div className="px-6 pb-6 pt-4">
              {items.length > 0 && (
                <ul className="mb-5 border-t border-line">
                  {items.map((it) => (
                    <li key={it.key} className="flex items-center gap-3 border-b border-line py-3">
                      {it.color && <ColorSwatch name={it.color} size="sm" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">
                          {it.article}
                          {it.qty > 1 && (
                            <span className="mono ml-2 text-[11px] text-mut">×{it.qty}</span>
                          )}
                        </div>
                        <div className="mono text-[9px] uppercase text-mut2">
                          {[
                            it.talle && `Talle ${it.talle}`,
                            it.isOtherBrand && (it.brand ?? "otra marca"),
                            it.discount > 0 && `-${Math.round(it.discount * 100)}%`,
                            it.available !== null && it.available < it.qty && `stock ${it.available}u`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </div>
                      <span className="font-serif text-[16px]">{arsFmt.format(saleNet(it))}</span>
                      <button
                        type="button"
                        aria-label={`Quitar ${it.article}`}
                        onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                        className="grid h-6 w-6 place-items-center rounded-full text-mut hover:text-acc"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <ProductPicker
                products={products}
                onAdd={(it) => setItems((prev) => [...prev, it])}
              />

              {items.length === 0 && (
                <p className="mono mt-4 text-center text-[11px] text-mut">
                  Buscá una prenda del catálogo (o cargá una de otra marca) y agregala a la venta.
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
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
              />
              <Field label="DNI" value={custDni} onChange={(e) => setCustDni(e.target.value)} />
              <Field
                label="MAIL O TELÉFONO"
                value={custContact}
                onChange={(e) => setCustContact(e.target.value)}
              />
              <Field
                label="DOMICILIO"
                value={custAddress}
                onChange={(e) => setCustAddress(e.target.value)}
              />
            </div>
          </Card>
        </div>

        {/* sidebar */}
        <div className="space-y-6">
          <Card>
            <CardTitle>Pago</CardTitle>
            <div className="grid grid-cols-2 gap-4 px-6 pb-6 pt-4">
              <Field
                label="FECHA"
                type="date"
                value={soldAt}
                onChange={(e) => setSoldAt(e.target.value)}
              />
              <Field
                label="DESCUENTO GENERAL %"
                type="number"
                min={0}
                max={99}
                value={saleDiscount}
                onChange={(e) => setSaleDiscount(e.target.value)}
              />
              <Dropdown label="FORMA DE PAGO" value={pago} options={PAGOS} onChange={changePago} />
              {showCuotas ? (
                <Dropdown
                  label="CUOTAS"
                  value={cuotas}
                  options={cuotaOptions.map(String)}
                  onChange={setCuotas}
                />
              ) : (
                <Dropdown label="PUNTO DE VENTA" value={punto} options={PUNTOS} onChange={setPunto} />
              )}
              {showCuotas && (
                <div className="col-span-2">
                  <Dropdown label="PUNTO DE VENTA" value={punto} options={PUNTOS} onChange={setPunto} />
                </div>
              )}

              <div className="col-span-2 border-t border-line pt-4">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[13px]">¿Se hizo factura?</span>
                  <Toggle on={invoiced} onChange={setInvoiced} />
                </div>
                {invoiced && <InvoiceUpload file={invoiceFile} onFile={setInvoiceFile} />}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[13px]">Entregado</span>
                  <Toggle on={delivered} onChange={setDelivered} />
                </div>
              </div>

              <div className="col-span-2 border-t border-line pt-4">
                {discountFraction > 0 && (
                  <>
                    <Line label={`Subtotal · ${units}u`} value={arsFmt.format(subtotal)} />
                    <Line
                      label={`Descuento ${Math.round(discountFraction * 100)}%`}
                      value={`-${arsFmt.format(subtotal - total)}`}
                      tone="acc"
                    />
                  </>
                )}
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="mono text-[10px] text-mut">
                    TOTAL{discountFraction === 0 && units > 0 ? ` · ${units}u` : ""}
                  </span>
                  <span className="font-serif text-[28px] leading-none">{arsFmt.format(total)}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Detalle</CardTitle>
            <div className="space-y-4 px-6 pb-6 pt-4">
              <Textarea
                label="NOTAS"
                placeholder="Observaciones: cambios, pagos parciales, avisos…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="flex items-center justify-between border-t border-line pt-4">
                <span className="mono text-[10px] text-mut">VENDEDOR</span>
                <span className="mono text-[11px] uppercase">{sellerName}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: "acc" }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="mono text-[10px] text-mut">{label}</span>
      <span className={cn("text-[13px]", tone === "acc" && "text-acc")}>{value}</span>
    </div>
  );
}

function InvoiceUpload({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="py-2">
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex items-center justify-between rounded-lg border border-line2 bg-panel px-3 py-2">
          <span className="mono min-w-0 flex-1 truncate text-[11px]">{file.name}</span>
          <button
            onClick={() => onFile(null)}
            className="ml-2 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-white"
            aria-label="Quitar factura"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => input.current?.click()}
          className="mono w-full rounded-lg border border-dashed border-line2 bg-panel px-3 py-2.5 text-[11px] text-mut transition-colors hover:border-ink/30"
        >
          Adjuntar factura · PDF o imagen
        </button>
      )}
    </div>
  );
}
