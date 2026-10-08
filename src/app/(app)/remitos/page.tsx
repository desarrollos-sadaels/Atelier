import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/queries";
import { getDeliveryNotes } from "@/lib/delivery-notes-server";
import { isAuthEnabled } from "@/lib/supabase/config";
import { ROLE_HOME } from "@/lib/roles";
import { RemitosClient } from "./RemitosClient";

export default async function RemitosPage() {
  const profile = await getCurrentProfile();
  if (isAuthEnabled()) {
    if (!profile) redirect("/login");
    if (profile.role === "medios") redirect(ROLE_HOME.medios);
  }

  const notes = await getDeliveryNotes();

  return (
    <RemitosClient initialRows={notes} />
  );
}
