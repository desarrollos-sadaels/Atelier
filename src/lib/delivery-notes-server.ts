import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { adjustInventory, getProductVariants } from "@/lib/shopify/inventory";
import type { DeliveryNoteItemRow, DeliveryNoteRow } from "@/lib/delivery-notes";

type Supa = ReturnType<typeof createAdminClient>;

async function refreshLocalProductStock(supa: Supa, productId: string | null): Promise<void> {
  if (!productId) return;
  try {
    const { data: product } = await supa
      .from("products")
      .select("id, shopify_id")
      .eq("id", productId)
      .maybeSingle();
    if (!product?.shopify_id) return;
    const fresh = await getProductVariants(product.shopify_id);
    if (!fresh) return;
    await supa
      .from("products")
      .update({ stock: fresh.total, updated_at: new Date().toISOString() })
      .eq("id", product.id);
  } catch {
    // El webhook de inventario vuelve a conciliarlo. El espejo local no debe
    // deshacer un movimiento que Shopify ya aplicó correctamente.
  }
}

export async function getDeliveryNotes(): Promise<DeliveryNoteRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_notes")
    .select("*, delivery_note_items(*)")
    .order("issued_at", { ascending: false })
    .order("number", { ascending: false });
  return (data ?? []) as DeliveryNoteRow[];
}

export async function getDeliveryNote(id: string): Promise<DeliveryNoteRow | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_notes")
    .select("*, delivery_note_items(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as DeliveryNoteRow | null) ?? null;
}

export async function deductLoanItem(
  supa: Supa,
  item: {
    id: string;
    productId: string | null;
    inventoryItemId: string | null;
    qty: number;
    article: string;
    allowOversell?: boolean;
  },
): Promise<string | null> {
  if (!item.productId || !item.inventoryItemId) {
    return `${item.article}: sin variante Shopify; el préstamo quedó registrado sin mover stock.`;
  }
  if (!isShopifyConfigured()) {
    return `${item.article}: Shopify no está configurado; no se descontó stock.`;
  }

  const { data: product, error } = await supa
    .from("products")
    .select("id, shopify_id, is_preorder")
    .eq("id", item.productId)
    .maybeSingle();
  if (error) return `${item.article}: ${error.message}`;
  if (!product?.shopify_id) return `${item.article}: el producto no tiene vínculo con Shopify.`;
  if (product.is_preorder) return `${item.article}: es pre-order y no mueve stock.`;

  try {
    const variants = await getProductVariants(product.shopify_id);
    const variant = variants?.variants.find((candidate) => candidate.inventoryItemId === item.inventoryItemId);
    if (!variant) return `${item.article}: la variante no pertenece al producto.`;
    if (!variant.tracked) return `${item.article}: Shopify no controla stock para esa variante.`;
    if (variant.available < item.qty && !item.allowOversell) {
      return `${item.article}: stock insuficiente; el préstamo quedó registrado sin descontar stock.`;
    }

    await adjustInventory([{ inventoryItemId: item.inventoryItemId, delta: -item.qty }], {
      idempotencyScope: `loan-deduct:${item.id}`,
      reference: `gid://atelier/DeliveryNoteItem/${item.id}`,
    });
    await refreshLocalProductStock(supa, item.productId);

    let marked = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await supa
        .from("delivery_note_items")
        .update({ stock_deducted: true, variant_gid: variant.id })
        .eq("id", item.id);
      if (!result.error) {
        marked = true;
        break;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    return marked
      ? variant.available < item.qty
        ? `${item.article}: el préstamo dejó el stock en negativo.`
        : null
      : `${item.article}: el stock se descontó, pero el préstamo no quedó marcado para reposición automática.`;
  } catch (cause) {
    return `${item.article}: no se pudo descontar stock (${cause instanceof Error ? cause.message : String(cause)}).`;
  }
}

export async function restockLoanItem(supa: Supa, item: DeliveryNoteItemRow): Promise<void> {
  if (!item.stock_deducted) return;

  const { data: claimed, error: claimError } = await supa
    .from("delivery_note_items")
    .update({ stock_deducted: false })
    .eq("id", item.id)
    .eq("stock_deducted", true)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) return;

  try {
    if (!item.inventory_item_id || !isShopifyConfigured()) {
      throw new Error("Shopify o la variante del préstamo no están disponibles");
    }
    await adjustInventory([{ inventoryItemId: item.inventory_item_id, delta: item.qty }], {
      idempotencyScope: `loan-restock:${item.id}`,
      reference: `gid://atelier/DeliveryNoteItemReturn/${item.id}`,
    });
    await refreshLocalProductStock(supa, item.product_id);
  } catch (cause) {
    await supa.from("delivery_note_items").update({ stock_deducted: true }).eq("id", item.id);
    throw cause;
  }
}
