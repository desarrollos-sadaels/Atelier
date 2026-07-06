"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Dropdown } from "@/components/Dropdown";
import { Dot, btnCls } from "@/components/ui";
import { Download, Plus, Dots } from "@/components/icons";
import type { UiProduct } from "@/lib/ui-types";
import { cn } from "@/lib/cn";

const metaColor = { a: "text-ink", p: "text-acc", n: "text-mut" } as const;
const STOCKS = ["Todos", "Stock", "Sin stock"];
const SHOPS = ["Todos", "Activo", "Sin stock", "Borrador"];
const PAGE_SIZE = 20;
const TOP_HIGHLIGHT = 10;

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const fmtARS = (n: number) => arsFmt.format(n);

type View = "catalogo" | "ranking";
type SortCol = "stock" | "precio";
type Sort = { col: SortCol; dir: 1 | -1 } | null;

export function CatalogoClient({ products }: { products: UiProduct[] }) {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [cat, setCat] = useState("Todas");
  const [stock, setStock] = useState("Todos");
  const [shop, setShop] = useState("Todos");
  const [view, setView] = useState<View>("catalogo");
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(1);

  // Un click ordena de menor a mayor; el siguiente invierte; el tercero limpia.
  const toggleSort = (col: SortCol) =>
    setSort((cur) =>
      cur?.col !== col ? { col, dir: 1 } : cur.dir === 1 ? { col, dir: -1 } : null,
    );

  const cats = useMemo(
    () => ["Todas", ...Array.from(new Set(products.map((p) => p.cat))).sort()],
    [products],
  );

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (q && !`${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (cat !== "Todas" && p.cat !== cat) return false;
      if (stock === "Sin stock" && !p.out) return false;
      if (stock === "Stock" && p.out) return false;
      if (shop !== "Todos" && p.shopify !== shop) return false;
      return true;
    });
  }, [products, q, cat, stock, shop]);

  const displayed = useMemo(() => {
    // Ranking: ordenar por ingreso potencial (stock × precio) desc.
    if (view === "ranking") {
      return [...filtered].sort((a, b) => b.stockNum * b.priceNum - a.stockNum * a.priceNum);
    }
    // Catálogo: orden opcional por columna (Stock / Precio).
    if (sort) {
      const key = sort.col === "stock" ? "stockNum" : "priceNum";
      return [...filtered].sort((a, b) => (a[key] - b[key]) * sort.dir);
    }
    return filtered;
  }, [filtered, view, sort]);

  const totalPages = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const pageRows = displayed.slice(start, start + PAGE_SIZE);

  // reset a página 1 si cambian filtros o la vista
  const filterKey = `${q}|${cat}|${stock}|${shop}|${view}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) {
    setLastKey(filterKey);
    setPage(1);
  }

  const isRanking = view === "ranking";

  return (
    <>
      <PageHeader
        kicker={`Catálogo · ${products.length} productos sincronizados`}
        title="Catálogo"
        actions={
          <>
            <button
              className={btnCls("ghost")}
              onClick={() => toast.success("Exportando catálogo…", { description: `${displayed.length} productos` })}
            >
              <Download className="h-4 w-4" /> Exportar
            </button>
            <Link href="/catalogo/nuevo" className={btnCls("primary")}>
              <Plus className="h-4 w-4" /> Nuevo producto
            </Link>
          </>
        }
      />

      {/* toggle de vista */}
      <div className="mt-8 inline-flex rounded-full border border-line2 p-0.5">
        {(["catalogo", "ranking"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "mono rounded-full px-4 py-1.5 text-[11px] uppercase tracking-wider transition-colors",
              view === v ? "bg-ink text-white" : "text-mut hover:text-ink",
            )}
          >
            {v === "catalogo" ? "Catálogo" : "Ranking"}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Dropdown label="Categoría" value={cat} options={cats} onChange={setCat} variant="pill" />
        <Dropdown label="Estado de stock" value={stock} options={STOCKS} onChange={setStock} variant="pill" />
        <Dropdown label="Estado Shopify" value={shop} options={SHOPS} onChange={setShop} variant="pill" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto, SKU…"
          className="mono h-9 w-48 rounded-full border border-line2 px-3.5 text-[11px] uppercase tracking-wider outline-none placeholder:text-mut focus:border-ink/40"
        />
        <span className="mono ml-auto text-[12px] text-mut">
          {displayed.length} / {products.length}
        </span>
      </div>

      {isRanking && (
        <p className="mono mt-4 text-[11px] text-mut">
          Ordenado por ingreso potencial = stock en mano × precio. Resaltados los top {TOP_HIGHLIGHT}.
        </p>
      )}

      {displayed.length === 0 ? (
        <div className="mt-16 grid place-items-center rounded-[4px] border border-dashed border-line2 py-20 text-center">
          <div className="font-serif text-[22px]">Sin resultados</div>
          <p className="mt-2 text-[13px] text-mut">Probá con otra búsqueda o limpiá los filtros.</p>
          <button
            className={btnCls("ghost", "mt-5")}
            onClick={() => {
              setQ("");
              setCat("Todas");
              setStock("Todos");
              setShop("Todos");
            }}
          >
            Limpiar filtros
          </button>
        </div>
      ) : isRanking ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] border-t border-line text-left">
            <thead>
              <tr className="mono text-[10px] text-mut">
                {["#", "Producto", "Categoría", "Stock", "Precio", "Ingreso potencial"].map((h, i) => (
                  <th
                    key={i}
                    className={cn("border-b border-line py-3 font-normal", i >= 3 && "text-right")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p, i) => {
                const rank = start + i + 1;
                const top = rank <= TOP_HIGHLIGHT;
                const potential = p.stockNum * p.priceNum;
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "group border-b border-line hover:bg-panel/60",
                      top && "bg-acc/[0.04]",
                    )}
                  >
                    <td className="py-3 pr-2">
                      <span
                        className={cn(
                          "mono grid h-6 w-6 place-items-center rounded-full text-[11px]",
                          top ? "bg-acc text-white" : "text-mut2",
                        )}
                      >
                        {rank}
                      </span>
                    </td>
                    <td className="py-3">
                      <Link href={`/catalogo/${p.id}`} className="flex items-center gap-3">
                        {p.image ? (
                          <Image
                            src={p.image}
                            alt={p.name}
                            width={40}
                            height={40}
                            className="h-10 w-10 shrink-0 rounded-[4px] border border-line2 object-cover"
                          />
                        ) : (
                          <span className="h-10 w-10 shrink-0 rounded-[4px] border border-line2 bg-tile" />
                        )}
                        <span className="block text-[14px] font-medium group-hover:underline">{p.name}</span>
                      </Link>
                    </td>
                    <td className="text-[13px] text-ink2">{p.cat}</td>
                    <td className={cn("text-right font-serif text-[17px]", p.out && "text-acc")}>{p.stock}</td>
                    <td className="text-right font-serif text-[17px]">{p.price}</td>
                    <td className={cn("text-right font-serif text-[17px]", top && "text-acc")}>
                      {fmtARS(potential)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] border-t border-line text-left">
            <thead>
              <tr className="mono text-[10px] text-mut">
                <th className="border-b border-line py-3 font-normal">Producto</th>
                <th className="border-b border-line py-3 font-normal">SKU</th>
                <th className="border-b border-line py-3 font-normal">Categoría</th>
                <SortableTh label="Precio" active={sort?.col === "precio"} dir={sort?.dir} onClick={() => toggleSort("precio")} />
                <SortableTh label="Stock" active={sort?.col === "stock"} dir={sort?.dir} onClick={() => toggleSort("stock")} />
                <th className="border-b border-line py-3 font-normal">Shopify</th>
                <th className="border-b border-line py-3 font-normal">Campaña Meta</th>
                <th className="border-b border-line py-3 font-normal" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p) => (
                <tr key={p.id} className="group border-b border-line hover:bg-panel/60">
                  <td className="py-3">
                    <Link href={`/catalogo/${p.id}`} className="flex items-center gap-3">
                      {p.image ? (
                        <Image
                          src={p.image}
                          alt={p.name}
                          width={40}
                          height={40}
                          className="h-10 w-10 shrink-0 rounded-[4px] border border-line2 object-cover"
                        />
                      ) : (
                        <span className="h-10 w-10 shrink-0 rounded-[4px] border border-line2 bg-tile" />
                      )}
                      <span>
                        <span className="block text-[14px] font-medium group-hover:underline">{p.name}</span>
                        <span className="mono block text-[9px] text-mut2">desde Shopify</span>
                      </span>
                    </Link>
                  </td>
                  <td className="mono text-[12px] text-mut">{p.sku}</td>
                  <td className="text-[13px] text-ink2">{p.cat}</td>
                  <td className="font-serif text-[17px]">{p.price}</td>
                  <td className={cn("font-serif text-[17px]", p.out && "text-acc")}>{p.stock}</td>
                  <td>
                    <span className="flex items-center gap-2 text-[12px] text-ink2">
                      <Dot alert={p.out} /> {p.shopify}
                    </span>
                  </td>
                  <td className={cn("mono text-[11px]", metaColor[p.metaState])}>{p.meta}</td>
                  <td className="text-right">
                    <button className="text-mut2 hover:text-ink" aria-label="Acciones">
                      <Dots className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {displayed.length > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <span className="mono text-[11px] text-mut">
            Mostrando {start + 1}–{Math.min(start + PAGE_SIZE, displayed.length)} de {displayed.length}
          </span>
          <div className="flex items-center gap-1.5">
            <PagerBtn label="‹" disabled={current === 1} onClick={() => setPage(current - 1)} />
            <span className="mono px-2 text-[11px] text-ink">
              {current} / {totalPages}
            </span>
            <PagerBtn label="›" disabled={current === totalPages} onClick={() => setPage(current + 1)} />
          </div>
        </div>
      )}
    </>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir?: 1 | -1;
  onClick: () => void;
}) {
  return (
    <th className="border-b border-line py-3 font-normal">
      <button
        onClick={onClick}
        className={cn(
          "mono inline-flex items-center gap-1 text-[10px] transition-colors hover:text-ink",
          active ? "text-ink" : "text-mut",
        )}
        title="Ordenar"
      >
        {label}
        <span className="text-[9px]">{active ? (dir === 1 ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

function PagerBtn({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mono grid h-7 w-7 place-items-center rounded-md border border-line2 text-[11px] text-ink hover:border-ink/40 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
