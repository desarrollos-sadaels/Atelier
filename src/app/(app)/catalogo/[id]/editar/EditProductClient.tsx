"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardTitle, Eyebrow, btnCls } from "@/components/ui";
import { Field, Textarea } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { ColorSwatch } from "@/components/ColorSwatch";
import { CATEGORY_OPTIONS, CATEGORY_SELECT_DEFAULT } from "@/lib/categories";

const CATS = [CATEGORY_SELECT_DEFAULT, ...CATEGORY_OPTIONS];
const ESTADOS = ["Borrador", "Activo", "Archivado"];

export type EditInitial = {
  name: string;
  description: string;
  category: string;
  vendor: string;
  status: string;
  alertThreshold: string;
};

export function EditProductClient({
  id,
  initial,
  readonlyInfo,
  colors,
  sizes,
}: {
  id: string;
  initial: EditInitial;
  readonlyInfo: { sku: string; price: string; barcode: string };
  colors: string[];
  sizes: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [cat, setCat] = useState(initial.category || "Seleccionar");
  const [vendor, setVendor] = useState(initial.vendor);
  const [estado, setEstado] = useState(initial.status || "Borrador");
  const [alertThreshold, setAlertThreshold] = useState(initial.alertThreshold);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    if (!name.trim()) return toast.error("Ingresá el nombre del producto");
    setSaving(true);
    const t = toast.loading("Guardando cambios en Shopify…");
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name.trim(),
          description,
          category: cat,
          vendor: vendor.trim() || undefined,
          status: estado,
          alertThreshold: Number(alertThreshold) || 10,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error guardando");
      toast.success("Producto actualizado", { id: t, description: "Sincronizado con Shopify." });
      router.push(`/catalogo/${id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error guardando", { id: t });
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-end justify-between gap-6 pt-9 pb-1">
        <div>
          <Eyebrow className="mb-3">Catálogo / Editar producto</Eyebrow>
          <h1 className="font-serif text-[44px] leading-none tracking-tight">Editar producto</h1>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <Link href={`/catalogo/${id}`} className={btnCls("ghost")}>
            Cancelar
          </Link>
          <button className={btnCls("primary")} disabled={saving} onClick={save}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_500px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Información básica</CardTitle>
            <div className="space-y-5 px-6 pb-6 pt-4">
              <Field
                label="NOMBRE DEL PRODUCTO"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Textarea
                label="DESCRIPCIÓN"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Dropdown label="CATEGORÍA" value={cat} options={CATS} onChange={setCat} />
                <Field
                  label="MARCA / PROVEEDOR"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Precio e identificadores</CardTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-6 pb-6 pt-4">
              {[
                ["PRECIO", readonlyInfo.price],
                ["SKU", readonlyInfo.sku],
                ["CÓD. DE BARRAS", readonlyInfo.barcode],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="mono text-[10px] text-mut">{k}</div>
                  <div className="mt-1 text-[14px]">{v}</div>
                </div>
              ))}
              <div className="col-span-2 -mt-1">
                <p className="text-[11px] text-mut">
                  Precio, SKU y stock se gestionan por variante (en el detalle del producto).
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Publicación</CardTitle>
            <div className="px-6 pb-6 pt-3">
              <Dropdown label="ESTADO" value={estado} options={ESTADOS} onChange={setEstado} />
              <div className="mt-5">
                <Field
                  label="UMBRAL DE ALERTA"
                  type="number"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Variantes</CardTitle>
            <div className="px-6 pb-6 pt-4">
              {colors.length > 0 && (
                <>
                  <div className="mono text-[10px] text-mut">COLORES</div>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {colors.map((c) => (
                      <ColorSwatch key={c} name={c} size="md" />
                    ))}
                  </div>
                </>
              )}
              {sizes.length > 0 && (
                <>
                  <div className="mono mt-5 text-[10px] text-mut">TALLES</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sizes.map((s) => (
                      <span
                        key={s}
                        className="mono rounded-full border border-line2 px-3 py-1 text-[11px]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {colors.length === 0 && sizes.length === 0 && (
                <p className="text-[12px] text-mut">Producto sin variantes.</p>
              )}
              <p className="mt-5 text-[11px] text-mut">
                La estructura de variantes se edita desde Shopify; el stock por variante desde el
                detalle del producto.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
