import { redirect } from "next/navigation";
import { getCurrentProfile, getPickerProducts, getPaymentMethods } from "@/lib/queries";
import { NuevaVentaClient } from "./NuevaVentaClient";

export default async function NuevaVentaPage() {
  const profile = await getCurrentProfile();
  // Medios solo trackea ventas; la carga es de admin/vendedor.
  if (profile && profile.role === "medios") redirect("/ventas");

  const [picker, paymentMethods] = await Promise.all([getPickerProducts(), getPaymentMethods()]);

  return (
    <NuevaVentaClient
      products={picker}
      sellerName={profile?.name ?? "—"}
      paymentMethods={paymentMethods}
    />
  );
}
