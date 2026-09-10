"use client";

import { useMemo, useState } from "react";
import { Field } from "@/components/forms";
import type { PickerProduct } from "@/lib/queries";

export function CatalogProductSearch({
  products,
  onSelect,
  label = "BUSCAR EN EL CATÁLOGO",
}: {
  products: PickerProduct[];
  onSelect: (product: PickerProduct) => void;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return products
      .filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [products, search]);

  return (
    <div className="relative">
      <Field
        label={label}
        placeholder="Nombre o SKU…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {search.trim() && products.length === 0 ? (
        <p className="mono mt-2 text-[10px] text-acc">
          No hay productos disponibles en el catálogo.
        </p>
      ) : results.length > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line2 bg-bg p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)]">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(product);
                  setSearch("");
                }}
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-panel"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{product.name}</div>
                  <div className="mono text-[10px] text-mut">
                    {product.sku} · stock {product.stock}u
                    {product.isPreorder ? " · PRE-ORDER" : ""}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
