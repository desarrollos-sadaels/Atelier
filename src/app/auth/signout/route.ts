import type { NextRequest } from "next/server";
import { signOutAndRedirect } from "@/lib/supabase/signout";

export async function POST(request: NextRequest) {
  return signOutAndRedirect(request, "local");
}
