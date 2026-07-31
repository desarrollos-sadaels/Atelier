import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/queries";
import { getAllMetaCampaigns } from "@/lib/meta/campaigns";
import { NuevoProductoClient } from "./NuevoProductoClient";

export default async function NuevoProductoPage() {
  const profile = await getCurrentProfile();
  // Alta de catálogo es acción de admin (misma regla que la API de products).
  if (profile && profile.role !== "admin") redirect("/catalogo");

  const campaigns = await getAllMetaCampaigns();

  return <NuevoProductoClient campaigns={campaigns} />;
}
