"use client";

import Link from "next/link";
import Image from "next/image";
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
import { saleNet } from "@/lib/sales";
import { cn } from "@/lib/cn";

export type PickerProduct = {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  price: number;
  stock: number;
};

type Variant = {
  id: string;
  color: string | null;
  size: string | null;
  optionLabel: string;
  available: number;
  inventoryItemId: string;
};

const PUNTOS = ["LOCAL", "SHOPIFY", "CHAT", "FASHION X GLOBAL", "AMIGOS Y FAMILIA"];

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

  // artículo
  const [otherBrand, setOtherBrand] = useState(false);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [talle, setTalle] = useState<string | null>(null);
  const [genericLabel, setGenericLabel] = useState<string | null>(null);
  // otra marca
  const [brand, setBrand] = useState("");
  const [freeArticle, setFreeArticle] = useState("");
  const [freeColor, setFreeColor] = useState("");
  const [freeTalle, setFreeTalle] = useState("");
  // cliente
  const [custName, setCustName] = useState("");
  const [custDni, setCustDni] = useState("");
  const [custContact, setCustContact] = useState("");
  const [custAddress, setCustAddress] = useState("");
  // venta
  const [soldAt, setSoldAt] = useState(today());
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("0");
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

  const selectedMethod = paymentMethods.find((m) => m.name === pago) ?? null;
  const cuotaOptions = selectedMethod?.installments ?? [];
  const showCuotas = cuotaOptions.length > 0;

  function changePago(name: string) {
    setPago(name);
    const m = paymentMethods.find((x) => x.name === name);
    setCuotas(m?.installments?.length ? String(m.installments[0]) : "");
  }

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return products
      .filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [products, search]);

  const colors = useMemo(
    () => [...new Set((variants ?? []).map((v) => v.color).filter(Boolean))] as string[],
    [variants],
  );
  const sizes = useMemo(() => {
    const pool = (variants ?? []).filter((v) => (color ? v.color === color : true));
    return [...new Set(pool.map((v) => v.size).filter(Boolean))] as string[];
  }, [variants, color]);

  // Cuando el producto tiene más de una variante pero ninguna se distingue por
  // color/talle (opciones de Shopify con otro nombre, ej. "Modelo"), no hay
  // forma segura de adivinar cuál se vendió: se ofrece un picker genérico por
  // optionLabel en vez de descontarle stock a `variants[0]` a ciegas.
  const isAmbiguous = (variants?.length ?? 0) > 1 && colors.length === 0 && sizes.length === 0;

  const selectedVariant = useMemo(() => {
    if (!variants) return null;
    if (variants.length <= 1) return variants[0] ?? null;
    if (isAmbiguous) return variants.find((v) => v.optionLabel === genericLabel) ?? null;
    return (
      variants.find(
        (v) => (color ? v.color === color : true) && (talle ? v.size === talle : true),
      ) ?? null
    );
  }, [variants, color, talle, isAmbiguous, genericLabel]);

  const needsColor = colors.length > 0 && !color;
  const needsTalle = sizes.length > 0 && !talle;
  const needsGeneric = isAmbiguous && !genericLabel;

  async function pickProduct(p: PickerProduct) {
    setProduct(p);
    setSearch("");
    setColor(null);
    setTalle(null);
    setGenericLabel(null);
    setVariants(null);
    if (!price) setPrice(String(p.price || ""));
    setLoadingVariants(true);
    try {
      const res = await fetch(`/api/products/${p.id}/variants`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudieron cargar las variantes");
      setVariants(data.variants ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar las variantes");
      setVariants([]);
    } finally {
      setLoadingVariants(false);
    }
  }

  async function submit() {
    if (saving) return;
    const priceNum = Number(price);
    const qtyNum = Math.trunc(Number(qty)) || 1;
    const discountNum = (Number(discount) || 0) / 100;

    if (!otherBrand && !product) return toast.error("Elegí un producto del catálogo");
    if (otherBrand && !freeArticle.trim()) return toast.error("Ingresá el artículo");
    if (!Number.isFinite(priceNum) || priceNum <= 0) return toast.error("Ingresá un precio válido");
    if (discountNum < 0 || discountNum >= 1) return toast.error("Descuento inválido (0–99%)");
    if (!otherBrand && (needsColor || needsTalle))
      return toast.error("Elegí color y talle de la variante vendida");
    if (!otherBrand && needsGeneric) return toast.error("Elegí la variante vendida");
    if (!otherBrand && selectedVariant && selectedVariant.available < qtyNum) {
      const ok = confirm(
        `La variante tiene stock ${selectedVariant.available} y estás vendiendo ${qtyNum}. ¿Registrar igual?`,
      );
      if (!ok) return;
    }

    setSaving(true);
    const t = toast.loading("Registrando venta…");
    try {
      // Clave de idempotencia: se genera una vez y se reusa en los reintentos
      // de ESTA venta. Si la request se duplica (doble tap, retry del browser,
      // respuesta perdida), el server devuelve la venta original en vez de
      // registrarla de nuevo y descontar stock dos veces. Si los datos
      // cambiaron desde el último intento (el usuario corrigió algo), se
      // descarta la clave vieja: si no, el reintento "exitoso" devolvería la
      // venta original con los datos viejos.
      const signature = JSON.stringify({
        soldAt, qty: qtyNum, price: priceNum, discount: discountNum,
        pago, cuotas, punto, invoiced, delivered, notes,
        custName, custDni, custContact, custAddress,
        otherBrand, brand, freeArticle, freeColor, freeTalle,
        productId: product?.id ?? null, color, talle, variantId: selectedVariant?.id ?? null,
        invoiceFile: invoiceFile ? `${invoiceFile.name}:${invoiceFile.size}:${invoiceFile.lastModified}` : null,
      });
      if (idempotencyKey.current && lastSignature.current !== signature) {
        idempotencyKey.current = null;
      }
      lastSignature.current = signature;
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

      // Subir la factura adjunta (si se marcó factura y se eligió archivo).
      let invoicePath: string | undefined;
      if (invoiced && invoiceFile) {
        toast.loading("Subiendo factura…", { id: t });
        invoicePath = await uploadInvoice(invoiceFile);
      }

      const res = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          soldAt,
          qty: qtyNum,
          price: priceNum,
          discount: discountNum,
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
          ...(otherBrand
            ? {
                isOtherBrand: true,
                brand: brand.trim() || undefined,
                article: freeArticle.trim(),
                color: freeColor.trim() || undefined,
                talle: freeTalle.trim() || undefined,
              }
            : {
                isOtherBrand: false,
                productId: product!.id,
                article: product!.name,
                color,
                talle,
                inventoryItemId: selectedVariant?.inventoryItemId,
                variantGid: selectedVariant?.id,
              }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error registrando la venta");
      toast.success("Venta registrada", {
        id: t,
        description: data.warning ?? (data.stockDeducted ? "Stock descontado en Shopify." : undefined),
      });
      router.push("/ventas");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error registrando la venta", { id: t });
      setSaving(false);
    }
  }

  // El descuento se edita en % acá y se guarda como fracción; el resto de la
  // fórmula es la misma que usan la tabla, los KPIs y el resumen diario.
  const net = saleNet({
    price: Number(price) || 0,
    discount: (Number(discount) || 0) / 100,
    qty: Math.trunc(Number(qty)) || 1,
  });

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
          <button className={btnCls("primary")} disabled={saving} onClick={submit}>
            {saving ? "Guardando…" : "Registrar venta"}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_460px]">
        {/* columna principal */}
        <div className="space-y-6">
          <Card>
            <CardTitle>Artículo</CardTitle>
            <div className="px-6 pb-6 pt-4">
              {/* toggle sadaels / otra marca */}
              <div className="inline-flex rounded-full border border-line2 p-0.5">
                {(["Producto Sadaels", "Otra marca"] as const).map((label, i) => (
                  <button
                    key={label}
                    onClick={() => setOtherBrand(i === 1)}
                    className={cn(
                      "mono rounded-full px-4 py-1.5 text-[11px] uppercase tracking-wider transition-colors",
                      (i === 1) === otherBrand ? "bg-ink text-white" : "text-mut hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {!otherBrand ? (
                <div className="mt-5">
                  {product ? (
                    <div className="flex items-center gap-4 rounded-lg border border-line2 p-3">
                      {product.image ? (
                        <Image
                          src={product.image}
                          alt={product.name}
                          width={48}
                          height={48}
                          className="h-12 w-12 rounded-[4px] border border-line2 object-cover"
                        />
                      ) : (
                        <span className="h-12 w-12 rounded-[4px] border border-line2 bg-tile" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">{product.name}</div>
                        <div className="mono text-[10px] text-mut">
                          {product.sku} · stock {product.stock}u · {arsFmt.format(product.price)}
                        </div>
                      </div>
                      <button
                        className="mono text-[10px] text-mut hover:text-acc"
                        onClick={() => {
                          setProduct(null);
                          setVariants(null);
                          setColor(null);
                          setTalle(null);
                          setGenericLabel(null);
                        }}
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Field
                        label="BUSCAR EN EL CATÁLOGO"
                        placeholder="Nombre o SKU…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {results.length > 0 && (
                        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-line2 bg-bg shadow-lg">
                          {results.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => pickProduct(p)}
                              className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-panel"
                            >
                              {p.image ? (
                                <Image
                                  src={p.image}
                                  alt={p.name}
                                  width={32}
                                  height={32}
                                  className="h-8 w-8 rounded-[4px] border border-line2 object-cover"
                                />
                              ) : (
                                <span className="h-8 w-8 rounded-[4px] border border-line2 bg-tile" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px]">{p.name}</span>
                                <span className="mono block text-[9px] text-mut">
                                  {p.sku} · stock {p.stock}u
                                </span>
                              </span>
                              <span className="mono text-[11px] text-mut">{arsFmt.format(p.price)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {product && (
                    <div className="mt-5">
                      {loadingVariants ? (
                        <p className="mono text-[11px] text-mut">Cargando variantes…</p>
                      ) : (
                        <>
                          {colors.length > 0 && (
                            <>
                              <div className="mono text-[10px] text-mut">COLOR</div>
                              <div className="mt-2.5 flex flex-wrap gap-2.5">
                                {colors.map((c) => (
                                  <ColorSwatch
                                    key={c}
                                    name={c}
                                    size="md"
                                    selected={color === c}
                                    onClick={() => {
                                      setColor(color === c ? null : c);
                                      setTalle(null);
                                    }}
                                  />
                                ))}
                              </div>
                            </>
                          )}
                          {sizes.length > 0 && (
                            <>
                              <div className="mono mt-4 text-[10px] text-mut">TALLE</div>
                              <div className="mt-2.5 flex flex-wrap gap-2">
                                {sizes.map((s) => {
                                  const v = (variants ?? []).find(
                                    (x) => (color ? x.color === color : true) && x.size === s,
                                  );
                                  const out = (v?.available ?? 0) <= 0;
                                  return (
                                    <button
                                      key={s}
                                      onClick={() => setTalle(talle === s ? null : s)}
                                      className={cn(
                                        "mono rounded-full px-3.5 py-1.5 text-[11px] transition-colors",
                                        talle === s
                                          ? "bg-ink text-white"
                                          : "border border-line2 text-ink hover:border-ink/40",
                                        out && talle !== s && "opacity-40",
                                      )}
                                    >
                                      {s}
                                      {v && <span className="ml-1.5 opacity-60">{v.available}u</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                          {isAmbiguous && (
                            <>
                              <div className="mono text-[10px] text-mut">VARIANTE</div>
                              <div className="mt-2.5">
                                <Dropdown
                                  value={genericLabel ?? "Elegir variante"}
                                  options={(variants ?? []).map((v) => v.optionLabel)}
                                  onChange={setGenericLabel}
                                />
                              </div>
                            </>
                          )}
                          {selectedVariant && !needsColor && !needsTalle && !needsGeneric && (
                            <p className="mono mt-4 text-[10px] text-mut">
                              Variante seleccionada · stock {selectedVariant.available}u — al registrar se
                              descuenta automáticamente.
                            </p>
                          )}
                          {variants && variants.length === 0 && (
                            <p className="mono mt-2 text-[10px] text-mut">
                              Sin variantes en Shopify; la venta no descuenta stock.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <Field
                    label="MARCA"
                    placeholder="Ej: Alexia, Calomel, Ferrens…"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                  />
                  <Field
                    label="ARTÍCULO"
                    placeholder="Ej: anillo sauron"
                    value={freeArticle}
                    onChange={(e) => setFreeArticle(e.target.value)}
                  />
                  <Field
                    label="COLOR (OPCIONAL)"
                    value={freeColor}
                    onChange={(e) => setFreeColor(e.target.value)}
                  />
                  <Field
                    label="TALLE (OPCIONAL)"
                    value={freeTalle}
                    onChange={(e) => setFreeTalle(e.target.value)}
                  />
                  <p className="col-span-2 text-[11px] text-mut">
                    Los artículos de otras marcas (consignación) no descuentan stock del catálogo.
                  </p>
                </div>
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
            <CardTitle>Venta</CardTitle>
            <div className="grid grid-cols-2 gap-4 px-6 pb-6 pt-4">
              <Field
                label="FECHA"
                type="date"
                value={soldAt}
                onChange={(e) => setSoldAt(e.target.value)}
              />
              <Field
                label="CANTIDAD"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <Field
                label="PRECIO $"
                type="number"
                placeholder="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <Field
                label="DESCUENTO %"
                type="number"
                min={0}
                max={99}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
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
                {invoiced && (
                  <InvoiceUpload file={invoiceFile} onFile={setInvoiceFile} />
                )}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[13px]">Entregado</span>
                  <Toggle on={delivered} onChange={setDelivered} />
                </div>
              </div>
              <div className="col-span-2 flex items-baseline justify-between border-t border-line pt-4">
                <span className="mono text-[10px] text-mut">TOTAL</span>
                <span className="font-serif text-[28px] leading-none">{arsFmt.format(net)}</span>
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
