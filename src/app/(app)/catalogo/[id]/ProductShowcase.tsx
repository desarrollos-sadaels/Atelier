"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ColorSwatch } from "@/components/ColorSwatch";
import { cn } from "@/lib/cn";
import type { VariantStock } from "@/lib/shopify/inventory";

export function ProductShowcase({
  productImages,
  variants,
  hasColor,
  hasSize,
  shopifyStatus,
  metaLabel,
  specs,
}: {
  productImages: string[];
  variants: VariantStock[];
  hasColor: boolean;
  hasSize: boolean;
  shopifyStatus: string;
  metaLabel: string;
  specs: [string, string][];
}) {
  // Colores únicos (orden de aparición) con imagen representativa y stock total.
  const colors = useMemo(() => {
    if (!hasColor) return [];
    const map = new Map<string, { name: string; image: string | null; stock: number }>();
    for (const v of variants) {
      if (!v.color) continue;
      const cur = map.get(v.color);
      if (cur) {
        cur.stock += v.available;
        if (!cur.image && v.imageUrl) cur.image = v.imageUrl;
      } else {
        map.set(v.color, { name: v.color, image: v.imageUrl, stock: v.available });
      }
    }
    return [...map.values()];
  }, [variants, hasColor]);

  const sizes = useMemo(() => {
    if (!hasSize) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of variants) {
      if (v.size && !seen.has(v.size)) {
        seen.add(v.size);
        out.push(v.size);
      }
    }
    return out;
  }, [variants, hasSize]);

  const [color, setColor] = useState<string | null>(colors[0]?.name ?? null);
  const [size, setSize] = useState<string | null>(sizes[0] ?? null);
  const [manualImg, setManualImg] = useState<string | null>(null);

  const colorImage = colors.find((c) => c.name === color)?.image ?? null;
  const mainImage = manualImg ?? colorImage ?? productImages[0] ?? null;

  // Stock disponible para una combinación.
  const availFor = (c: string | null, s: string | null) =>
    variants
      .filter((v) => (c == null || v.color === c) && (s == null || v.size === s))
      .reduce((sum, v) => sum + v.available, 0);

  const selectedAvail = availFor(color, size);
  const thumbs = productImages.length > 1 ? productImages : [];

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[420px_1fr]">
      {/* imagen */}
      <div>
        <div className="relative h-[480px] w-full overflow-hidden rounded-[4px] border border-line2 bg-tile">
          {mainImage ? (
            <Image src={mainImage} alt="" fill className="object-contain" sizes="420px" />
          ) : (
            <div className="grid h-full place-items-center text-[12px] text-mut">Sin imagen</div>
          )}
        </div>
        {thumbs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {thumbs.map((src) => (
              <button
                key={src}
                onClick={() => setManualImg(src)}
                className={cn(
                  "relative h-14 w-14 overflow-hidden rounded-[4px] border",
                  mainImage === src ? "border-ink" : "border-line2",
                )}
              >
                <Image src={src} alt="" fill className="object-cover" sizes="56px" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* selectores + specs */}
      <div>
        <div className="mono flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
          <span className={selectedAvail === 0 ? "text-acc" : "text-ink"}>
            ● {selectedAvail === 0 ? "Sin stock" : "En stock"}
          </span>
          <span className="text-mut">○ Shopify: {shopifyStatus}</span>
          <span className="text-mut">○ Meta: {metaLabel}</span>
        </div>

        {colors.length > 0 && (
          <div className="mt-6">
            <div className="mono mb-2.5 text-[10px] text-mut">
              COLOR{color ? <span className="text-ink2"> · {color}</span> : null}
            </div>
            <div className="flex flex-wrap gap-3">
              {colors.map((c) => (
                <ColorSwatch
                  key={c.name}
                  name={c.name}
                  size="lg"
                  selected={c.name === color}
                  muted={c.stock === 0}
                  onClick={() => {
                    setColor(c.name);
                    setManualImg(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {sizes.length > 0 && (
          <div className="mt-6">
            <div className="mono mb-2.5 text-[10px] text-mut">TALLE</div>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => {
                const avail = availFor(color, s);
                return (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={cn(
                      "mono min-w-10 rounded-full px-3.5 py-1.5 text-[11px] transition-colors",
                      s === size
                        ? "bg-ink text-white"
                        : "border border-line2 text-ink hover:border-ink/40",
                      avail === 0 && s !== size && "text-mut2 line-through",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(colors.length > 0 || sizes.length > 0) && selectedAvail === 0 && (
          <div className="mt-5 flex items-center gap-2 rounded-[4px] border border-acc/30 bg-acc/5 px-3.5 py-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-acc" />
            <span className="text-[12px] text-acc">
              Sin stock{color ? ` en ${color}` : ""}
              {size ? ` · talle ${size}` : ""}.
            </span>
          </div>
        )}
        {(colors.length > 0 || sizes.length > 0) && selectedAvail > 0 && selectedAvail <= 3 && (
          <div className="mt-5 flex items-center gap-2 rounded-[4px] border border-line2 bg-panel px-3.5 py-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
            <span className="text-[12px] text-ink2">
              Últimas {selectedAvail} unidades{color ? ` en ${color}` : ""}
              {size ? ` · talle ${size}` : ""}.
            </span>
          </div>
        )}

        <div className="hair mt-7" />
        <div className="mt-6 grid grid-cols-2 gap-y-7">
          {specs.map(([k, v]) => (
            <div key={k}>
              <div className="mono text-[10px] text-mut">{k}</div>
              <div className="mt-0.5 font-serif text-[20px]">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
