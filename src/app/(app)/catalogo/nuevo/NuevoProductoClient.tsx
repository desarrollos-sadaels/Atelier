"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardTitle, Eyebrow, btnCls } from "@/components/ui";
import { Field, Textarea } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { ColorSwatch } from "@/components/ColorSwatch";
import { X } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_OPTIONS, CATEGORY_SELECT_DEFAULT } from "@/lib/categories";
import { cn } from "@/lib/cn";
import type { MetaCampaignOption } from "@/lib/meta/campaigns";

const TALLES = ["XS", "S", "M", "L", "XL", "XXL"];
const PALETTE = [
  "Negro", "Blanco", "Off white", "Gris", "Beige", "Marrón", "Rojo", "Bordó",
  "Rosa", "Amarillo", "Verde", "Azul", "Celeste", "Turquesa", "Violeta",
];
const CATS = [CATEGORY_SELECT_DEFAULT, ...CATEGORY_OPTIONS];
const ESTADOS = ["Borrador", "Activo", "Archivado"];
const NO_CAMPAIGN = "Seleccionar campaña…";

type Img = { file: File; url: string };
type Combo = { talle: string | null; color: string | null; key: string; label: string };

async function uploadImages(files: File[]): Promise<string[]> {
  if (!files.length) return [];
  const supabase = createClient();
  const urls: string[] = [];
  for (const file of files) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw new Error(`No se pudo subir la imagen: ${error.message}`);
    urls.push(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
  }
  return urls;
}

export function NuevoProductoClient({ campaigns }: { campaigns: MetaCampaignOption[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cat, setCat] = useState("Seleccionar");
  const [marca, setMarca] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("10");
  const [estado, setEstado] = useState("Borrador");
  const [campaign, setCampaign] = useState(NO_CAMPAIGN);

  const [talles, setTalles] = useState<string[]>(["S", "M", "L"]);
  const [colors, setColors] = useState<string[]>([]);
  const [comboQty, setComboQty] = useState<Record<string, string>>({});
  const [singleStock, setSingleStock] = useState("0");

  const [images, setImages] = useState<Img[]>([]);
  const [saving, setSaving] = useState(false);

  const combos = useMemo<Combo[]>(() => {
    if (!talles.length && !colors.length) return [];
    const ts = talles.length ? talles : [null];
    const cs = colors.length ? colors : [null];
    const out: Combo[] = [];
    for (const t of ts)
      for (const c of cs) {
        const parts = [t, c].filter(Boolean) as string[];
        out.push({ talle: t, color: c, key: parts.join("__"), label: parts.join(" / ") });
      }
    return out;
  }, [talles, colors]);

  const toggle = (arr: string[], set: (v: string[]) => void, val: string) =>
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setImages((cur) => [...cur, ...next]);
  }
  function removeImage(idx: number) {
    setImages((cur) => {
      URL.revokeObjectURL(cur[idx]?.url);
      return cur.filter((_, i) => i !== idx);
    });
  }

  async function linkCampaign(productId: string) {
    const picked = campaigns.find((c) => c.name === campaign);
    if (!picked) return;
    try {
      const res = await fetch(`/api/products/${productId}/campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaCampaignId: picked.id, name: picked.name }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.warning("El producto se creó, pero no se pudo vincular la campaña de Meta.");
    }
  }

  async function submit(publishStatus: string) {
    if (saving) return;
    if (!name.trim()) return toast.error("Ingresá el nombre del producto");
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) return toast.error("Ingresá un precio válido");

    setSaving(true);
    const t = toast.loading("Creando producto en Shopify…");
    try {
      const imageUrls = await uploadImages(images.map((i) => i.file));

      const options: { name: string; values: string[] }[] = [];
      if (talles.length) options.push({ name: "Talle", values: talles });
      if (colors.length) options.push({ name: "Color", values: colors });

      const variants = combos.map((c) => ({
        optionValues: [
          ...(c.talle ? [{ name: "Talle", value: c.talle }] : []),
          ...(c.color ? [{ name: "Color", value: c.color }] : []),
        ],
        qty: Number(comboQty[c.key]) || 0,
      }));

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name.trim(),
          description: description.trim() || undefined,
          category: cat,
          vendor: marca.trim() || undefined,
          status: publishStatus,
          price: priceNum,
          cost: cost === "" ? undefined : Number(cost),
          sku: sku.trim() || undefined,
          barcode: barcode.trim() || undefined,
          alertThreshold: Number(alertThreshold) || 10,
          options,
          variants,
          stock: Number(singleStock) || 0,
          imageUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error creando el producto");

      if (data.id && campaign !== NO_CAMPAIGN) await linkCampaign(data.id);

      toast.success(
        publishStatus === "Borrador" ? "Borrador guardado" : "Producto publicado",
        { id: t, description: "Sincronizado con Shopify y el catálogo interno." },
      );
      router.push(data.id ? `/catalogo/${data.id}` : "/catalogo");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error creando el producto", { id: t });
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-end justify-between gap-6 pt-9 pb-1">
        <div>
          <Eyebrow className="mb-3">Catálogo / Nuevo producto</Eyebrow>
          <h1 className="font-serif text-[44px] leading-none tracking-tight">Nuevo producto</h1>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <Link href="/catalogo" className={btnCls("ghost")}>
            Cancelar
          </Link>
          <button className={btnCls("primary")} disabled={saving} onClick={() => submit(estado)}>
            {saving ? "Guardando…" : estado === "Borrador" ? "Guardar producto" : "Publicar producto"}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_500px]">
        {/* main form */}
        <div className="space-y-6">
          <Card>
            <CardTitle>Información básica</CardTitle>
            <div className="space-y-5 px-6 pb-6 pt-4">
              <Field
                label="NOMBRE DEL PRODUCTO"
                placeholder="Ej: Balance Blazer"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Textarea
                label="DESCRIPCIÓN"
                placeholder="Texto descriptivo del producto…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Dropdown label="CATEGORÍA" value={cat} options={CATS} onChange={setCat} />
                <Field
                  label="MARCA / PROVEEDOR"
                  placeholder="Ej: Sadaels"
                  value={marca}
                  onChange={(e) => setMarca(e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Imágenes</CardTitle>
            <div className="space-y-4 px-6 pb-6 pt-4">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInput.current?.click()}
                className="grid h-24 w-full place-items-center rounded-lg border border-dashed border-line2 bg-panel transition-colors hover:border-ink/30"
              >
                <span className="mono text-[11px] text-mut">
                  Hacé clic para subir imágenes · PNG, JPG
                </span>
              </button>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {images.map((img, i) => (
                    <div key={img.url} className="relative h-20 w-20">
                      <Image
                        src={img.url}
                        alt=""
                        width={80}
                        height={80}
                        unoptimized
                        className="h-20 w-20 rounded-lg border border-line2 object-cover"
                      />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-ink text-white"
                        aria-label="Quitar imagen"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Precio e inventario</CardTitle>
            <div className="grid grid-cols-2 gap-4 px-6 pb-6 pt-4">
              <Field
                label="PRECIO DE VENTA"
                placeholder="0"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <Field
                label="COSTO"
                placeholder="0"
                type="number"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
              <Field
                label="SKU (BASE)"
                placeholder="SAD-0000"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
              <div>
                <Field
                  label="CÓDIGO DE BARRAS"
                  placeholder="7790000000000"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  disabled={combos.length > 1}
                />
                {combos.length > 1 && (
                  <p className="mono mt-1.5 text-[10px] text-mut">
                    No aplica con color/talle: cada variante necesita su propio código.
                  </p>
                )}
              </div>
              <Field
                label="UMBRAL DE ALERTA"
                placeholder="10"
                type="number"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
              />
            </div>
          </Card>
        </div>

        {/* sidebar */}
        <div className="space-y-6">
          <Card>
            <CardTitle>Publicación</CardTitle>
            <div className="px-6 pb-6 pt-3">
              <Dropdown label="ESTADO" value={estado} options={ESTADOS} onChange={setEstado} />
              <p className="mt-3 text-[11px] text-mut">
                {estado === "Activo"
                  ? "Se publica visible en la tienda online."
                  : estado === "Archivado"
                    ? "Se crea archivado (oculto)."
                    : "Se crea como borrador en Shopify (no visible al público)."}
              </p>
            </div>
          </Card>

          <Card>
            <CardTitle>Variantes y stock</CardTitle>
            <div className="px-6 pb-6 pt-4">
              <div className="mono text-[10px] text-mut">TALLES</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {TALLES.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggle(talles, setTalles, t)}
                    className={cn(
                      "mono rounded-full px-3.5 py-1.5 text-[11px] transition-colors",
                      talles.includes(t)
                        ? "bg-ink text-white"
                        : "border border-line2 text-ink hover:border-ink/40",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="mono mt-5 text-[10px] text-mut">COLORES</div>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {PALETTE.map((c) => (
                  <ColorSwatch
                    key={c}
                    name={c}
                    size="md"
                    selected={colors.includes(c)}
                    onClick={() => toggle(colors, setColors, c)}
                  />
                ))}
              </div>

              {combos.length > 0 ? (
                <div className="mt-5">
                  <div className="mono mb-2 text-[10px] text-mut">
                    STOCK POR VARIANTE · {combos.length}
                  </div>
                  <div className="max-h-64 space-y-2 overflow-auto pr-1">
                    {combos.map((c) => (
                      <div key={c.key} className="flex items-center gap-3">
                        {c.color && <ColorSwatch name={c.color} size="sm" />}
                        <span className="mono flex-1 truncate text-[12px]">{c.label}</span>
                        <input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={comboQty[c.key] ?? ""}
                          onChange={(e) =>
                            setComboQty((cur) => ({ ...cur, [c.key]: e.target.value }))
                          }
                          className="h-9 w-20 rounded-lg border border-line2 px-3 text-right text-[13px] outline-none focus:border-ink/40"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-5">
                  <Field
                    label="STOCK (PRODUCTO SIN VARIANTES)"
                    placeholder="0"
                    type="number"
                    value={singleStock}
                    onChange={(e) => setSingleStock(e.target.value)}
                  />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Vincular a campaña Meta</CardTitle>
            <div className="px-6 pb-6 pt-4">
              {campaigns.length === 0 ? (
                <p className="mono text-[11px] text-mut">
                  {campaigns.length === 0
                    ? "No hay campañas de Meta disponibles para vincular todavía."
                    : ""}
                </p>
              ) : (
                <Dropdown
                  label="CAMPAÑA"
                  value={campaign}
                  options={[NO_CAMPAIGN, ...campaigns.map((c) => c.name)]}
                  onChange={setCampaign}
                />
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-mut">
                Si vinculás una campaña, avisamos al equipo de medios (campanita + email) apenas
                este producto se quede sin stock. No pausamos la campaña automáticamente.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
