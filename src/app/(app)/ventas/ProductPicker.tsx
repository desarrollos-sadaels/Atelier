"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { ColorSwatch } from "@/components/ColorSwatch";
import { btnCls } from "@/components/ui";
import type { PickerProduct } from "@/lib/queries";
import { cn } from "@/lib/cn";

export type { PickerProduct } from "@/lib/queries";

export type Variant = {
  id: string;
  color: string | null;
  size: string | null;
  optionLabel: string;
  available: number;
  inventoryItemId: string;
};

/** Prenda elegida, con todo lo que el endpoint de cambio necesita. */
export type ChosenItem = {
  key: string;
  productId: string | null;
  inventoryItemId: string | null;
  variantGid: string | null;
  article: string;
  color: string | null;
  talle: string | null;
  brand: string | null;
  isOtherBrand: boolean;
  qty: number;
  price: number;
  discount: number;
  /** Solo para mostrar el faltante antes de confirmar. */
  available: number | null;
};

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/**
 * Elegir una prenda del catálogo, con su variante.
 *
 * Es la misma mecánica que el formulario de Registrar venta, incluido el caso
 * raro: un producto con varias variantes que no se distinguen por color ni
 * talle (opciones de Shopify con otro nombre, "Modelo" por ejemplo). Ahí no hay
 * forma segura de adivinar cuál se llevó el cliente, así que se ofrece un
 * picker genérico por etiqueta en vez de descontarle stock a la primera.
 */
export function ProductPicker({
  products,
  onAdd,
}: {
  products: PickerProduct[];
  onAdd: (item: ChosenItem) => void;
}) {
  const [otherBrand, setOtherBrand] = useState(false);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [talle, setTalle] = useState<string | null>(null);
  const [genericLabel, setGenericLabel] = useState<string | null>(null);

  const [brand, setBrand] = useState("");
  const [freeArticle, setFreeArticle] = useState("");
  const [freeColor, setFreeColor] = useState("");
  const [freeTalle, setFreeTalle] = useState("");

  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("0");

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(needle)).slice(0, 6);
  }, [products, search]);

  const colors = useMemo(
    () => [...new Set((variants ?? []).map((v) => v.color).filter(Boolean))] as string[],
    [variants],
  );
  const sizes = useMemo(() => {
    const pool = (variants ?? []).filter((v) => (color ? v.color === color : true));
    return [...new Set(pool.map((v) => v.size).filter(Boolean))] as string[];
  }, [variants, color]);

  const isAmbiguous = (variants?.length ?? 0) > 1 && colors.length === 0 && sizes.length === 0;

  const selectedVariant = useMemo(() => {
    if (!variants) return null;
    if (variants.length <= 1) return variants[0] ?? null;
    if (isAmbiguous) return variants.find((v) => v.optionLabel === genericLabel) ?? null;
    return (
      variants.find((v) => (color ? v.color === color : true) && (talle ? v.size === talle : true)) ??
      null
    );
  }, [variants, color, talle, isAmbiguous, genericLabel]);

  const needsVariant =
    !otherBrand &&
    ((colors.length > 0 && !color) || (sizes.length > 0 && !talle) || (isAmbiguous && !genericLabel));

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

  function reset() {
    setProduct(null);
    setVariants(null);
    setColor(null);
    setTalle(null);
    setGenericLabel(null);
    setBrand("");
    setFreeArticle("");
    setFreeColor("");
    setFreeTalle("");
    setQty("1");
    setPrice("");
    setDiscount("0");
  }

  function add() {
    const qtyNum = Math.trunc(Number(qty)) || 1;
    const priceNum = Number(price);
    const discountNum = (Number(discount) || 0) / 100;

    if (!otherBrand && !product) return toast.error("Elegí un producto del catálogo");
    if (otherBrand && !freeArticle.trim()) return toast.error("Ingresá el artículo");
    if (!Number.isFinite(priceNum) || priceNum <= 0) return toast.error("Ingresá un precio válido");
    if (discountNum < 0 || discountNum >= 1) return toast.error("Descuento inválido (0–99%)");
    if (needsVariant) return toast.error("Elegí la variante de la prenda");

    onAdd({
      key: crypto.randomUUID(),
      productId: otherBrand ? null : product!.id,
      inventoryItemId: otherBrand ? null : (selectedVariant?.inventoryItemId ?? null),
      variantGid: otherBrand ? null : (selectedVariant?.id ?? null),
      article: otherBrand ? freeArticle.trim() : product!.name,
      color: otherBrand ? freeColor.trim() || null : color,
      talle: otherBrand ? freeTalle.trim() || null : talle,
      brand: otherBrand ? brand.trim() || null : null,
      isOtherBrand: otherBrand,
      qty: qtyNum,
      price: priceNum,
      discount: discountNum,
      available: otherBrand ? null : (selectedVariant?.available ?? null),
    });
    reset();
  }

  return (
    <div className="rounded-lg border border-line2 p-4">
      <div className="inline-flex rounded-full border border-line2 p-0.5">
        {(["Producto Sadaels", "Otra marca"] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setOtherBrand(i === 1);
              reset();
            }}
            className={cn(
              "mono rounded-full px-3.5 py-1.5 text-[10px] uppercase tracking-wider transition-colors",
              (i === 1) === otherBrand ? "bg-ink text-white" : "text-mut hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {!otherBrand ? (
        <div className="mt-4">
          {product ? (
            <div className="flex items-center gap-3 rounded-lg border border-line2 p-2.5">
              {product.image ? (
                <Image
                  src={product.image}
                  alt={product.name}
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-[4px] border border-line2 object-cover"
                />
              ) : (
                <span className="h-10 w-10 rounded-[4px] border border-line2 bg-tile" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{product.name}</div>
                <div className="mono text-[10px] text-mut">
                  {product.sku} · stock {product.stock}u · {arsFmt.format(product.price)}
                </div>
              </div>
              <button
                type="button"
                className="mono text-[10px] text-mut hover:text-acc"
                onClick={reset}
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
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line2 bg-bg p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)]">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => pickProduct(p)}
                        className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-panel"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]">{p.name}</div>
                          <div className="mono text-[10px] text-mut">
                            {p.sku} · {p.stock}u · {arsFmt.format(p.price)}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {loadingVariants && <p className="mono mt-3 text-[11px] text-mut">Cargando variantes…</p>}

          {!loadingVariants && product && (
            <div className="mt-4">
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
                    {sizes.map((sz) => {
                      const v = (variants ?? []).find(
                        (x) => (color ? x.color === color : true) && x.size === sz,
                      );
                      const out = (v?.available ?? 0) <= 0;
                      return (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setTalle(talle === sz ? null : sz)}
                          className={cn(
                            "mono rounded-full px-3.5 py-1.5 text-[11px] transition-colors",
                            talle === sz
                              ? "bg-ink text-white"
                              : "border border-line2 text-ink hover:border-ink/40",
                            out && talle !== sz && "opacity-40",
                          )}
                        >
                          {sz}
                          {v && <span className="ml-1.5 opacity-60">{v.available}u</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {isAmbiguous && (
                <>
                  <div className="mono mt-4 text-[10px] text-mut">VARIANTE</div>
                  <div className="mt-2.5">
                    <Dropdown
                      value={genericLabel ?? "Elegir variante"}
                      options={(variants ?? []).map((v) => v.optionLabel)}
                      onChange={setGenericLabel}
                    />
                  </div>
                </>
              )}

              {selectedVariant && !needsVariant && (
                <p
                  className={cn(
                    "mono mt-3 text-[10px]",
                    selectedVariant.available < (Math.trunc(Number(qty)) || 1) ? "text-acc" : "text-mut",
                  )}
                >
                  Stock de la variante: {selectedVariant.available}u — al registrar se descuenta
                  automáticamente.
                </p>
              )}
              {variants && variants.length === 0 && (
                <p className="mono mt-3 text-[10px] text-mut">
                  Sin variantes en Shopify; esta prenda no descuenta stock.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="MARCA" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <Field
            label="ARTÍCULO"
            value={freeArticle}
            onChange={(e) => setFreeArticle(e.target.value)}
          />
          <Field label="COLOR" value={freeColor} onChange={(e) => setFreeColor(e.target.value)} />
          <Field label="TALLE" value={freeTalle} onChange={(e) => setFreeTalle(e.target.value)} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Field
          label="CANTIDAD"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Field
          label="PRECIO UNITARIO"
          type="number"
          min={0}
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
      </div>

      <button type="button" onClick={add} className={btnCls("ghost", "mt-4 h-9 w-full text-[12px]")}>
        Agregar prenda
      </button>
    </div>
  );
}
