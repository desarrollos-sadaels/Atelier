import { Suspense } from "react";
import { getProducts } from "@/lib/queries";
import { CatalogoClient } from "./CatalogoClient";

export default async function CatalogoPage() {
  const products = await getProducts();
  return (
    <Suspense fallback={<div className="pt-9" />}>
      <CatalogoClient products={products} />
    </Suspense>
  );
}
