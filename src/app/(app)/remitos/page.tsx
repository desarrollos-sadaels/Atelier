import { redirect } from "next/navigation";
import { getCurrentProfile, getExternalBrands, getPickerProducts } from "@/lib/queries";
import { getDeliveryNotes } from "@/lib/delivery-notes-server";
import { isAuthEnabled } from "@/lib/supabase/config";
import { ROLE_HOME } from "@/lib/roles";
import { RemitosClient } from "./RemitosClient";

const ART_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
});

export default async function RemitosPage() {
  const profile = await getCurrentProfile();
  if (isAuthEnabled()) {
    if (!profile) redirect("/login");
    if (profile.role === "medios") redirect(ROLE_HOME.medios);
  }

  const [notes, products, brands] = await Promise.all([
    getDeliveryNotes(),
    getPickerProducts(),
    getExternalBrands(),
  ]);

  return (
    <RemitosClient
      initialRows={notes}
      products={products}
      brands={brands}
      today={ART_DATE.format(new Date())}
    />
  );
}

