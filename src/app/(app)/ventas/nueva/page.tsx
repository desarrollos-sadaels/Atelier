import { redirect } from "next/navigation";
import { getCurrentProfile, getProducts, getPaymentMethods } from "@/lib/queries";
import { NuevaVentaClient, type PickerProduct } from "./NuevaVentaClient";

export default async function NuevaVentaPage() {
  const profile = await getCurrentProfile();
  // Medios solo trackea ventas; la carga es de admin/vendedor.
  if (profile && profile.role === "medios") redirect("/ventas");

  const [products, paymentMethods] = await Promise.all([getProducts(), getPaymentMethods()]);
  const picker: PickerProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    image: p.image,
    price: p.priceNum,
    stock: p.stockNum,
  }));

  return (
    <NuevaVentaClient
      products={picker}
      sellerName={profile?.name ?? "—"}
      paymentMethods={paymentMethods}
    />
  );
}
