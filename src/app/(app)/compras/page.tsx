import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { btnCls } from "@/components/ui";
import { Download, Plus } from "@/components/icons";
import { getDashboardStats } from "@/lib/queries";

export default async function ComprasPage() {
  const stats = await getDashboardStats();
  const kpis = [
    { label: "Órdenes abiertas", value: "0", sub: "sin órdenes aún" },
    { label: "En tránsito", value: "0", sub: "—" },
    { label: "Recibidas / mes", value: "0", sub: "—" },
    { label: "Gasto del mes", value: "—", sub: "sin compras registradas" },
  ];

  return (
    <>
      <PageHeader
        kicker="Compras y reposición"
        title="Compras"
        actions={
          <>
            <Link href="/compras/reporte" className={btnCls("ghost")}>
              <Download className="h-4 w-4" /> Reporte de ventas
            </Link>
            <button className={btnCls("primary")}>
              <Plus className="h-4 w-4" /> Nueva orden
            </button>
          </>
        }
      />

      <div className="mt-8">
        <KpiRow items={kpis} />
      </div>

      {stats.lowStock + stats.outStock > 0 && (
        <div className="mt-8 flex items-center gap-3 rounded-[4px] border border-line2 bg-panel px-5 py-4">
          <span className="h-3 w-3 rounded-full bg-acc" />
          <span className="text-[13px] text-ink2">
            {stats.lowStock + stats.outStock} productos en o bajo el umbral —{" "}
            <Link href="/catalogo" className="underline">
              revisá el catálogo
            </Link>{" "}
            para generar una reposición.
          </span>
        </div>
      )}

      <div className="mt-10 grid place-items-center rounded-[4px] border border-dashed border-line py-20 text-center">
        <div className="font-serif text-[22px]">Sin órdenes de compra todavía</div>
        <p className="mono mt-2 text-[12px] text-mut">
          Cuando registres órdenes a proveedores, las vas a ver acá.
        </p>
        <button className={btnCls("primary", "mt-5")}>
          <Plus className="h-4 w-4" /> Nueva orden de compra
        </button>
      </div>
    </>
  );
}
