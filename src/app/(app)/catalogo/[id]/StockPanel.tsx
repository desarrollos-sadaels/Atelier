"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardTitle, btnCls } from "@/components/ui";
import { ColorSwatch } from "@/components/ColorSwatch";
import { Plus, X } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { VariantStock } from "@/lib/shopify/inventory";

type Row = { variant: VariantStock; qty: string };

export function StockPanel({
  productId,
  initialVariants,
  hasColor,
  hasSize,
  alertThreshold,
  fallbackTotal,
}: {
  productId: string;
  initialVariants: VariantStock[] | null;
  hasColor: boolean;
  hasSize: boolean;
  alertThreshold: number;
  fallbackTotal: number;
}) {
  const router = useRouter();
  const [variants, setVariants] = useState<VariantStock[] | null>(initialVariants);
  const [rows, setRows] = useState<Row[]>([]);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => (variants ? variants.reduce((s, v) => s + v.available, 0) : fallbackTotal),
    [variants, fallbackTotal],
  );

  const colors = useMemo(() => {
    if (!variants || !hasColor) return [];
    const m = new Map<string, number>();
    for (const v of variants) if (v.color) m.set(v.color, (m.get(v.color) ?? 0) + v.available);
    return [...m.entries()].map(([name, stock]) => ({ name, stock }));
  }, [variants, hasColor]);

  const sizes = useMemo(() => {
    if (!variants || !hasSize) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of variants) if (v.size && !seen.has(v.size)) (seen.add(v.size), out.push(v.size));
    return out;
  }, [variants, hasSize]);

  const hasOptions = hasColor || hasSize;
  const singleVariant = variants && variants.length === 1 ? variants[0] : null;

  function findVariant(): VariantStock | undefined {
    if (!variants) return undefined;
    return variants.find(
      (v) => (!hasColor || v.color === color) && (!hasSize || v.size === size),
    );
  }

  function addRow() {
    if (hasColor && !color) return toast.error("Elegí un color");
    if (hasSize && !size) return toast.error("Elegí un talle");
    const v = findVariant();
    if (!v) return toast.error("Esa combinación no existe");
    if (rows.some((r) => r.variant.id === v.id)) return toast("Ya está en la lista");
    setRows((cur) => [...cur, { variant: v, qty: "1" }]);
  }

  function setQty(id: string, qty: string) {
    setRows((cur) => cur.map((r) => (r.variant.id === id ? { ...r, qty } : r)));
  }
  function removeRow(id: string) {
    setRows((cur) => cur.filter((r) => r.variant.id !== id));
  }

  const pending = rows
    .map((r) => ({ inventoryItemId: r.variant.inventoryItemId, delta: Math.trunc(Number(r.qty)) }))
    .filter((c) => Number.isFinite(c.delta) && c.delta !== 0);

  async function apply() {
    if (saving || !pending.length) return;
    setSaving(true);
    const t = toast.loading("Actualizando inventario en Shopify…");
    try {
      const res = await fetch(`/api/products/${productId}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: pending }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error ajustando inventario");
      setVariants(data.variants as VariantStock[]);
      setRows([]);
      toast.success("Inventario actualizado", { id: t, description: `${data.total}u en total` });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error ajustando inventario", { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardTitle>Stock e inventario</CardTitle>
      <div className="px-6 pb-6">
        <div className="mt-4 flex items-end gap-3">
          <div className={`font-serif text-[70px] leading-none ${total === 0 ? "text-acc" : "text-ink"}`}>
            {total}
          </div>
          <div className="pb-2 text-[13px] leading-tight text-mut">
            unidades
            <br />
            disponibles
          </div>
        </div>
        <div className="mono mt-4 text-[11px] text-mut">
          Umbral de alerta {alertThreshold}u
          {total === 0 ? " · sin stock" : total <= alertThreshold ? " · stock bajo" : ""}
        </div>

        {variants === null ? (
          <p className="mt-5 text-[12px] text-mut">No se pudo leer el inventario desde Shopify.</p>
        ) : (
          <>
            <div className="hair mt-5" />

            {/* Selector de variante a reponer */}
            {hasOptions ? (
              <div className="mt-4">
                <div className="mono mb-2 text-[10px] text-mut">REPONER VARIANTE</div>
                {hasColor && (
                  <div className="mb-3 flex flex-wrap gap-2.5">
                    {colors.map((c) => (
                      <ColorSwatch
                        key={c.name}
                        name={c.name}
                        size="md"
                        selected={c.name === color}
                        muted={c.stock === 0}
                        onClick={() => setColor(c.name)}
                      />
                    ))}
                  </div>
                )}
                {hasSize && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {sizes.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSize(s)}
                        className={cn(
                          "mono min-w-9 rounded-full px-3 py-1 text-[11px] transition-colors",
                          s === size
                            ? "bg-ink text-white"
                            : "border border-line2 text-ink hover:border-ink/40",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <button className={btnCls("ghost", "h-9 w-full text-[12px]")} onClick={addRow}>
                  <Plus className="h-4 w-4" /> Agregar a la lista
                </button>
              </div>
            ) : singleVariant ? (
              <div className="mt-4">
                <button
                  className={btnCls("ghost", "h-9 w-full text-[12px]")}
                  onClick={() =>
                    rows.length
                      ? undefined
                      : setRows([{ variant: singleVariant, qty: "1" }])
                  }
                >
                  <Plus className="h-4 w-4" /> Reponer este producto
                </button>
              </div>
            ) : null}

            {/* Lista de reposición */}
            {rows.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="mono grid grid-cols-[1fr_44px_64px_20px] items-center gap-2 text-[9px] text-mut2">
                  <span>VARIANTE</span>
                  <span className="text-right">STOCK</span>
                  <span className="text-right">SUMAR</span>
                  <span />
                </div>
                {rows.map((r) => (
                  <div
                    key={r.variant.id}
                    className="grid grid-cols-[1fr_44px_64px_20px] items-center gap-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {r.variant.color && <ColorSwatch name={r.variant.color} size="sm" />}
                      <span className="truncate text-[12px] font-medium">{r.variant.optionLabel}</span>
                    </div>
                    <div className="text-right font-serif text-[15px] tabular-nums">
                      {r.variant.available}
                    </div>
                    <input
                      type="number"
                      value={r.qty}
                      onChange={(e) => setQty(r.variant.id, e.target.value)}
                      className="h-8 w-full rounded-lg border border-line2 px-2 text-right text-[13px] outline-none focus:border-ink/40"
                    />
                    <button
                      onClick={() => removeRow(r.variant.id)}
                      className="text-mut2 hover:text-acc"
                      aria-label="Quitar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              className={btnCls("primary", "mt-5 h-11 w-full")}
              disabled={saving || pending.length === 0}
              onClick={apply}
            >
              {saving
                ? "Aplicando…"
                : pending.length
                  ? `Reponer stock (${pending.length})`
                  : "Reponer stock"}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
