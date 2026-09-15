"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import { Dropdown } from "@/components/Dropdown";
import { CatalogProductSearch } from "@/components/CatalogProductSearch";
import { ColorSwatch } from "@/components/ColorSwatch";
import { Field, Textarea } from "@/components/forms";
import { Chip, btnCls } from "@/components/ui";
import { Plus } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { PickerProduct, WorkshopOrderRow } from "@/lib/queries";

const STATUS_OPTIONS = ["Pendiente de enviar", "En proceso", "Terminado"];

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

type ShopifyVariant = {
  id: string;
  color: string | null;
  size: string | null;
  optionLabel: string;
};

function productLabel(product: PickerProduct): string {
  return `${product.name} · ${product.sku}`;
}

function statusLabel(status: string): string {
  if (status === "finished") return "Terminado";
  if (status === "in_process") return "En proceso";
  return "Pendiente de enviar";
}

function statusValue(label: string): string {
  if (label === "Terminado") return "finished";
  if (label === "En proceso") return "in_process";
  return "pending_send";
}

export function TallerClient({
  initialRows,
  products,
}: {
  initialRows: WorkshopOrderRow[];
  products: PickerProduct[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [previousRows, setPreviousRows] = useState(initialRows);
  const [editing, setEditing] = useState<WorkshopOrderRow | null>(null);
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [productId, setProductId] = useState("");
  const [variants, setVariants] = useState<ShopifyVariant[] | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [color, setColor] = useState("");
  const [talle, setTalle] = useState("");
  const [variantLabel, setVariantLabel] = useState("");
  const [price, setPrice] = useState("");
  const [shippingAmount, setShippingAmount] = useState("0");
  const [detail, setDetail] = useState("");
  const [status, setStatus] = useState("Pendiente de enviar");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const variantRequest = useRef(0);

  if (initialRows !== previousRows) {
    setPreviousRows(initialRows);
    setRows(initialRows);
  }

  const selectedProduct = products.find((product) => product.id === productId) ?? null;
  const colors = useMemo(
    () => [...new Set((variants ?? []).map((variant) => variant.color).filter(Boolean))] as string[],
    [variants],
  );
  const sizes = useMemo(() => {
    const matchingColor = (variants ?? []).filter((variant) =>
      colors.length > 0 && color ? variant.color === color : true,
    );
    return [...new Set(matchingColor.map((variant) => variant.size).filter(Boolean))] as string[];
  }, [variants, colors.length, color]);
  const isAmbiguous = (variants?.length ?? 0) > 1 && colors.length === 0 && sizes.length === 0;
  const selectedVariant = useMemo(() => {
    if (!variants?.length) return null;
    if (isAmbiguous) {
      return variants.find((variant) => variant.optionLabel === variantLabel) ?? null;
    }
    if (variants.length === 1 && colors.length === 0 && sizes.length === 0) return variants[0];
    return (
      variants.find(
        (variant) =>
          (colors.length > 0 && color ? variant.color === color : true) &&
          (sizes.length > 0 && talle ? variant.size === talle : true),
      ) ?? null
    );
  }, [variants, isAmbiguous, variantLabel, colors.length, sizes.length, color, talle]);

  const priceNumber = Number(price);
  const shippingNumber = shippingAmount.trim() === "" ? 0 : Number(shippingAmount);
  const total =
    (Number.isFinite(priceNumber) ? priceNumber : 0) +
    (Number.isFinite(shippingNumber) ? shippingNumber : 0);

  async function loadVariants(id: string) {
    const request = ++variantRequest.current;
    setLoadingVariants(true);
    setVariants(null);
    try {
      const res = await fetch(`/api/products/${id}/variants`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudieron cargar las variantes");
      if (request !== variantRequest.current) return;
      setVariants(data.variants ?? []);
    } catch (error) {
      if (request !== variantRequest.current) return;
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las variantes");
      setVariants([]);
    } finally {
      if (request === variantRequest.current) setLoadingVariants(false);
    }
  }

  function clearProduct() {
    variantRequest.current += 1;
    setProductId("");
    setVariants(null);
    setLoadingVariants(false);
    setColor("");
    setTalle("");
    setVariantLabel("");
    setPrice("");
  }

  function pickProduct(product: PickerProduct) {
    setProductId(product.id);
    setColor("");
    setTalle("");
    setVariantLabel("");
    setPrice(String(product.price ?? 0));
    void loadVariants(product.id);
  }

  function startCreate() {
    setEditing(null);
    setCustomerName("");
    setCustomerContact("");
    clearProduct();
    setShippingAmount("0");
    setDetail("");
    setStatus("Pendiente de enviar");
    setOpen(true);
  }

  function startEdit(row: WorkshopOrderRow) {
    setEditing(row);
    setCustomerName(row.customer_name);
    setCustomerContact(row.customer_contact ?? "");
    setProductId(row.product_id ?? "");
    setColor(row.color ?? "");
    setTalle(row.talle ?? "");
    setVariantLabel(row.variant_label ?? "");
    setPrice(String(Number(row.price) || 0));
    setShippingAmount(String(Number(row.shipping_amount) || 0));
    setDetail(row.detail ?? "");
    setStatus(statusLabel(row.status));
    setOpen(true);
    if (row.product_id) void loadVariants(row.product_id);
    else {
      variantRequest.current += 1;
      setVariants([]);
      setLoadingVariants(false);
    }
  }

  async function save() {
    if (saving) return;
    if (!customerName.trim()) return toast.error("Ingresá el nombre del cliente");
    if (!productId) return toast.error("Seleccioná un producto del catálogo");
    if (!price.trim() || !Number.isFinite(priceNumber) || priceNumber < 0) {
      return toast.error("Ingresá un precio válido");
    }
    if (!Number.isFinite(shippingNumber) || shippingNumber < 0) {
      return toast.error("Ingresá un costo de envío válido");
    }
    if (loadingVariants) return toast.error("Esperá a que terminen de cargar las variantes");
    if ((colors.length > 0 && !color) || (sizes.length > 0 && !talle)) {
      return toast.error("Elegí el color y el talle de la prenda");
    }
    if (isAmbiguous && !variantLabel) return toast.error("Elegí la variante de la prenda");
    if ((variants?.length ?? 0) > 1 && !selectedVariant) {
      return toast.error("La combinación de color y talle no existe en Shopify");
    }

    setSaving(true);
    const notification = toast.loading(editing ? "Guardando pedido…" : "Creando pedido y venta…");
    try {
      const res = await fetch(
        editing ? `/api/taller/${editing.id}` : "/api/taller",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName,
            customerContact,
            productId,
            color,
            talle,
            variantLabel: selectedVariant?.optionLabel ?? variantLabel,
            price: priceNumber,
            shippingAmount: shippingNumber,
            detail,
            status: statusValue(status),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      toast.success(editing ? "Pedido y venta actualizados" : "Pedido enviado a Taller y sumado a Ventas", {
        id: notification,
      });
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar", { id: notification });
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: WorkshopOrderRow) {
    if (
      deleting ||
      !confirm(`¿Eliminar el pedido de ${row.customer_name} y su registro en Ventas?`)
    ) {
      return;
    }
    setDeleting(row.id);
    const notification = toast.loading("Eliminando pedido y venta…");
    try {
      const res = await fetch(`/api/taller/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo eliminar");
      setRows((current) => current.filter((item) => item.id !== row.id));
      toast.success("Pedido y venta eliminados", { id: notification });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar", { id: notification });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHeader
        kicker={`Taller · ${rows.length} pedidos`}
        title="Pedidos y ventas de Taller"
        actions={
          <button className={btnCls("primary")} onClick={startCreate}>
            <Plus className="h-4 w-4" /> Nuevo pedido
          </button>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-10 grid place-items-center rounded-[4px] border border-dashed border-line py-20 text-center">
          <div className="font-serif text-[22px]">Sin pedidos para Taller</div>
          <p className="mono mt-2 text-[12px] text-mut">
            Registrá acá las prendas que el equipo tiene que preparar.
          </p>
          <button className={btnCls("primary", "mt-5")} onClick={startCreate}>
            Crear pedido
          </button>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[1120px] border-t border-line text-left">
            <thead>
              <tr className="mono text-[10px] text-mut">
                {[
                  "Cliente",
                  "Contacto",
                  "Producto",
                  "Color / talle",
                  "Venta",
                  "Detalle",
                  "Solicitado por",
                  "Estado",
                  "",
                ].map((heading) => (
                  <th key={heading} className="border-b border-line py-3 pr-4 font-normal">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line align-top hover:bg-panel/60">
                  <td className="py-4 pr-4 text-[14px] font-medium">{row.customer_name}</td>
                  <td className="py-4 pr-4 text-[13px] text-ink2">{row.customer_contact ?? "—"}</td>
                  <td className="py-4 pr-4 text-[13px]">{row.product_name}</td>
                  <td className="mono py-4 pr-4 text-[11px] text-mut">
                    {[
                      row.color,
                      row.talle && `Talle ${row.talle}`,
                      !row.color && !row.talle ? row.variant_label : null,
                    ]
                      .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
                      .join(" · ") || "—"}
                  </td>
                  <td className="py-4 pr-4">
                    <div className="font-serif text-[17px]">
                      {ars.format(Number(row.price) + Number(row.shipping_amount))}
                    </div>
                    <div className="mono text-[9px] text-mut2">
                      PRENDA {ars.format(Number(row.price))}
                      {Number(row.shipping_amount) > 0
                        ? ` · ENVÍO ${ars.format(Number(row.shipping_amount))}`
                        : ""}
                    </div>
                  </td>
                  <td className="max-w-[280px] whitespace-pre-wrap py-4 pr-4 text-[12px] text-ink2">
                    {row.detail ?? "—"}
                  </td>
                  <td className="py-4 pr-4 text-[12px] text-ink2">
                    {row.created_by_name ?? "—"}
                  </td>
                  <td className="py-4 pr-4">
                    <Chip tone={row.status === "finished" ? "acc" : "default"}>
                      {statusLabel(row.status)}
                    </Chip>
                  </td>
                  <td className="py-4 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="mono text-[10px] text-mut hover:text-ink"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={deleting === row.id}
                        onClick={() => remove(row)}
                        className="mono text-[10px] text-acc hover:underline disabled:opacity-40"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar pedido de Taller" : "Nuevo pedido de Taller"}
        subtitle="Se suma como venta del Atelier. No modifica stock ni Shopify."
        width="lg"
        footer={
          <>
            <button type="button" className={btnCls("ghost")} onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button type="button" className={btnCls("primary")} disabled={saving} onClick={save}>
              {saving ? "Guardando…" : "Guardar pedido"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="CLIENTE"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
            <Field
              label="CONTACTO"
              value={customerContact}
              onChange={(event) => setCustomerContact(event.target.value)}
            />
          </div>

          {selectedProduct ? (
            <div>
              <span className="mono text-[10px] text-mut">PRODUCTO</span>
              <div className="mt-2 flex h-11 items-center justify-between rounded-lg border border-line2 px-3.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ink2">{productLabel(selectedProduct)}</div>
                  <div className="mono text-[9px] text-mut2">
                    {ars.format(selectedProduct.price)}
                    {selectedProduct.isPreorder ? " · PRE-ORDER" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="mono ml-3 text-[10px] text-mut hover:text-acc"
                  onClick={clearProduct}
                >
                  Cambiar
                </button>
              </div>
            </div>
          ) : (
            <CatalogProductSearch products={products} label="PRODUCTO" onSelect={pickProduct} />
          )}

          {loadingVariants && (
            <p className="mono text-[11px] text-mut">Cargando colores y talles de Shopify…</p>
          )}

          {!loadingVariants && selectedProduct && variants && (
            <div className="rounded-lg border border-line2 p-4">
              {colors.length > 0 && (
                <div>
                  <div className="mono text-[10px] text-mut">COLOR</div>
                  <div className="mt-2.5 flex flex-wrap gap-2.5">
                    {colors.map((value) => (
                      <ColorSwatch
                        key={value}
                        name={value}
                        size="md"
                        selected={color === value}
                        onClick={() => {
                          setColor(color === value ? "" : value);
                          setTalle("");
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {sizes.length > 0 && (
                <div className={cn(colors.length > 0 && "mt-4")}>
                  <div className="mono text-[10px] text-mut">TALLE</div>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {sizes.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTalle(talle === value ? "" : value)}
                        className={cn(
                          "mono rounded-full px-3.5 py-1.5 text-[11px] transition-colors",
                          talle === value
                            ? "bg-ink text-white"
                            : "border border-line2 text-ink hover:border-ink/40",
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isAmbiguous && (
                <Dropdown
                  label="VARIANTE"
                  value={variantLabel || "Elegir variante"}
                  options={variants.map((variant) => variant.optionLabel)}
                  onChange={setVariantLabel}
                />
              )}

              {!isAmbiguous && (colors.length === 0 || sizes.length === 0) && (
                <div className="mt-4 grid grid-cols-2 gap-4 first:mt-0">
                  {colors.length === 0 && (
                    <Field label="COLOR" value={color} onChange={(event) => setColor(event.target.value)} />
                  )}
                  {sizes.length === 0 && (
                    <Field label="TALLE" value={talle} onChange={(event) => setTalle(event.target.value)} />
                  )}
                </div>
              )}

              <p className="mono mt-3 text-[10px] text-mut2">
                La variante se usa solo como referencia del pedido; no descuenta ni reserva stock.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="PRECIO"
              type="number"
              min={0}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
            <Field
              label="COSTO DE ENVÍO"
              type="number"
              min={0}
              value={shippingAmount}
              onChange={(event) => setShippingAmount(event.target.value)}
            />
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="mono text-[10px] text-mut">TOTAL DE LA VENTA</span>
            <span className="font-serif text-[26px]">{ars.format(total)}</span>
          </div>

          <Textarea
            label="DETALLE / MEDIDAS / INDICACIONES"
            placeholder="Indicaciones libres para el taller…"
            rows={5}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
          <Dropdown label="ESTADO" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        </div>
      </Modal>
    </>
  );
}
