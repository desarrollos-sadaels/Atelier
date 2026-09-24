"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { ColorSwatch } from "@/components/ColorSwatch";
import { CatalogProductSearch } from "@/components/CatalogProductSearch";
import { btnCls } from "@/components/ui";
import type { PickerProduct } from "@/lib/queries";
import type { ExternalBrand } from "@/lib/external-brands";
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
  externalBrandRate: number | null;
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
  brands,
  onAdd,
  wholesale = false,
  onWholesaleChange,
}: {
  products: PickerProduct[];
  brands: ExternalBrand[];
  onAdd: (item: ChosenItem) => void;
  /** Mayorista usa únicamente catálogo Sadaels, PVP vigente y descuento general. */
  wholesale?: boolean;
  /** En Registrar venta, permite elegir Mayorista como tercer tipo de operación. */
  onWholesaleChange?: (enabled: boolean) => boolean;
}) {
  const [otherBrand, setOtherBrand] = useState(false);
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
  const selectedBrand = brands.find((candidate) => candidate.name === brand) ?? null;
  const brandOptions = brands.map((candidate) => `${candidate.name} · ${candidate.percentage}%`);

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

  function chooseMode(next: "catalog" | "other-brand" | "wholesale") {
    if (next === "wholesale") {
      if (!onWholesaleChange?.(true)) return;
      setOtherBrand(false);
    } else {
      if (wholesale && onWholesaleChange && !onWholesaleChange(false)) return;
      setOtherBrand(next === "other-brand");
    }
    reset();
  }

  function add() {
    const qtyNum = Math.trunc(Number(qty)) || 1;
    const priceNum = Number(price);
    const discountNum = wholesale ? 0 : (Number(discount) || 0) / 100;

    if (!otherBrand && !product) return toast.error("Elegí un producto del catálogo");
    if (otherBrand && !freeArticle.trim()) return toast.error("Ingresá el artículo");
    if (otherBrand && !selectedBrand) return toast.error("Elegí una marca configurada");
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
      brand: otherBrand ? selectedBrand!.name : null,
      externalBrandRate: otherBrand ? selectedBrand!.percentage / 100 : null,
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
        {[
          { label: "Producto Sadaels", mode: "catalog" as const, active: !wholesale && !otherBrand },
          { label: "Otra marca", mode: "other-brand" as const, active: !wholesale && otherBrand },
          ...(onWholesaleChange
            ? [{ label: "Venta mayorista", mode: "wholesale" as const, active: wholesale }]
            : []),
        ].map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => chooseMode(option.mode)}
            className={cn(
              "mono rounded-full px-3.5 py-1.5 text-[10px] uppercase tracking-wider transition-colors",
              option.active ? "bg-ink text-white" : "text-mut hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {wholesale && (
        <p className="mono mt-3 text-[10px] uppercase tracking-wider text-mut">
          Productos Sadaels al PVP vigente · descuento mayorista aplicado a la compra
        </p>
      )}

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
                  {product.isPreorder ? " · PRE-ORDER" : ""}
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
            <CatalogProductSearch products={products} onSelect={pickProduct} />
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
          <div>
            <Dropdown
              label="MARCA"
              value={selectedBrand ? `${selectedBrand.name} · ${selectedBrand.percentage}%` : "Elegir marca"}
              options={brandOptions}
              onChange={(option) => setBrand(brands.find((candidate) => `${candidate.name} · ${candidate.percentage}%` === option)?.name ?? "")}
            />
            {selectedBrand && (
              <p className="mono mt-1 text-[10px] text-mut">
                Ingreso Sadaels: {selectedBrand.percentage}% del precio neto
              </p>
            )}
          </div>
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
          label={wholesale ? "PVP UNITARIO" : "PRECIO UNITARIO"}
          type="number"
          min={0}
          value={price}
          disabled={wholesale}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Field
          label={wholesale ? "DESCUENTO POR PRENDA %" : "DESCUENTO %"}
          type="number"
          min={0}
          max={99}
          value={wholesale ? "0" : discount}
          disabled={wholesale}
          onChange={(e) => setDiscount(e.target.value)}
        />
      </div>

      <button type="button" onClick={add} className={btnCls("ghost", "mt-4 h-9 w-full text-[12px]")}>
        Agregar prenda
      </button>
    </div>
  );
}
