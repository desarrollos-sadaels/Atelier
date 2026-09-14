import { redirect } from "next/navigation";
import { getCurrentProfile, getPickerProducts, getWorkshopOrders } from "@/lib/queries";
import { isAuthEnabled } from "@/lib/supabase/config";
import { ROLE_HOME } from "@/lib/roles";
import { TallerClient } from "./TallerClient";

export default async function TallerPage() {
  const profile = await getCurrentProfile();
  if (isAuthEnabled()) {
    if (!profile) redirect("/login");
    if (profile.role === "medios") redirect(ROLE_HOME.medios);
  }

  const [orders, products] = await Promise.all([
    getWorkshopOrders(),
    getPickerProducts(),
  ]);

  return <TallerClient initialRows={orders} products={products} />;
}
