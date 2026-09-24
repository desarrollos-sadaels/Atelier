import { redirect } from "next/navigation";
import {
  getCurrentProfile,
  getPickerProducts,
  getPaymentMethods,
  getExternalBrands,
  getWholesaleSettings,
} from "@/lib/queries";
import { NuevaVentaClient } from "./NuevaVentaClient";

export default async function NuevaVentaPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { tipo } = await searchParams;
  const profile = await getCurrentProfile();
  // Medios solo trackea ventas; la carga es de admin/vendedor.
  if (profile && profile.role === "medios") redirect("/ventas");

  const [picker, paymentMethods, brands, wholesaleSettings] = await Promise.all([
    getPickerProducts(), getPaymentMethods(), getExternalBrands(), getWholesaleSettings(),
  ]);

  return (
    <NuevaVentaClient
      products={picker}
      sellerName={profile?.name ?? "—"}
      paymentMethods={paymentMethods}
      brands={brands}
      wholesaleSettings={wholesaleSettings}
      initialWholesale={tipo === "mayorista"}
    />
  );
}
