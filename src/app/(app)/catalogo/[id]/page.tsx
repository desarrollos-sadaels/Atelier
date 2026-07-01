import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle, btnCls } from "@/components/ui";
import { ChevronLeft } from "@/components/icons";
import { ProductShowcase } from "./ProductShowcase";
import { StockPanel } from "./StockPanel";
import { getProductById, formatARS } from "@/lib/queries";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { getProductVariants, type ProductVariants } from "@/lib/shopify/inventory";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProductById(id);
  if (!p) notFound();

  // Stock por variante en vivo desde Shopify (fuente de verdad del inventario).
  let pv: ProductVariants | null = null;
  if (p.shopify_id && isShopifyConfigured()) {
    try {
      pv = await getProductVariants(p.shopify_id);
    } catch {
      pv = null;
    }
  }
  const variants = pv?.variants ?? null;
  const hasColor = Boolean(pv?.colorOptionName);
  const hasSize = Boolean(pv?.sizeOptionName);

  const images =
    p.images && p.images.length > 0 ? p.images : p.image_url ? [p.image_url] : [];
  const specs: [string, string][] = [
    ["SKU", p.sku ?? "—"],
    ["Categoría", p.category ?? "—"],
    ["Precio de venta", formatARS(p.price)],
    ["Costo", formatARS(p.cost)],
    ["Proveedor", p.provider ?? "—"],
    ["Cód. de barras", p.barcode ?? "—"],
  ];
  const lastSync = new Date(p.updated_at).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <>
      <div className="flex items-end justify-between gap-6 pt-9 pb-1">
        <div>
          <span className="mono text-[11px] text-mut">Catálogo / {p.name}</span>
          <h1 className="mt-3 font-serif text-[44px] leading-none tracking-tight">{p.name}</h1>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <Link href="/catalogo" className={btnCls("ghost")}>
            <ChevronLeft className="h-4 w-4" /> Volver
          </Link>
          <Link href={`/catalogo/${p.id}/editar`} className={btnCls("primary")}>
            Editar producto
          </Link>
        </div>
      </div>

      <div className="mt-8">
        <ProductShowcase
          productImages={images}
          variants={variants ?? []}
          hasColor={hasColor}
          hasSize={hasSize}
          shopifyStatus={p.shopify_status ?? "—"}
          specs={specs}
        />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <StockPanel
          productId={p.id}
          initialVariants={variants}
          hasColor={hasColor}
          hasSize={hasSize}
          alertThreshold={p.alert_threshold}
          fallbackTotal={p.stock}
        />

        <Card>
          <CardTitle>Sincronización Shopify</CardTitle>
          <div className="px-6 pb-6 pt-4">
            {[
              ["Producto vinculado", p.shopify_id ? `#${p.shopify_id}` : "—"],
              ["Estado", p.shopify_status ?? "—"],
              ["Última actualización", lastSync],
              ["Gestionado por", "Shopify ↔ Atelier"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-2.5">
                <span className="text-[13px] text-mut">{k}</span>
                <span className="mono text-[12px]">{v}</span>
              </div>
            ))}
            <button className={btnCls("ghost", "mt-3 h-10 text-[12px]")}>Forzar sincronización</button>
          </div>
        </Card>

        <Card>
          <CardTitle>Campaña Meta vinculada</CardTitle>
          <div className="px-6 pb-6 pt-4">
            <div className="text-[15px] font-medium">Sin campaña vinculada</div>
            <p className="mono mt-3 text-[11px] leading-relaxed text-mut">
              Vinculá este producto con una campaña de Meta Ads para pausar/avisar
              automáticamente al quedar sin stock.
            </p>
            <button className={btnCls("ghost", "mt-5 h-10 text-[12px]")}>Vincular campaña</button>
          </div>
        </Card>
      </div>
    </>
  );
}
