import { Suspense } from "react";
import { getProducts, getCurrentProfile } from "@/lib/queries";
import { CatalogoClient } from "./CatalogoClient";

export default async function CatalogoPage() {
  const [products, profile] = await Promise.all([getProducts(), getCurrentProfile()]);
  const canManage = !profile || profile.role === "admin";
  return (
    <Suspense fallback={<div className="pt-9" />}>
      <CatalogoClient products={products} canManage={canManage} />
    </Suspense>
  );
}
