import { shopifyGraphql } from "./client";

export type ProductBasics = {
  title: string;
  descriptionHtml: string;
  productType: string | null;
  vendor: string | null;
  status: string; // ACTIVE / DRAFT / ARCHIVED
};

export async function getProductBasics(shopifyId: string): Promise<ProductBasics | null> {
  const data = await shopifyGraphql<{ product: ProductBasics | null }>(
    `query Basics($id: ID!) {
      product(id: $id) { title descriptionHtml productType vendor status }
    }`,
    { id: `gid://shopify/Product/${shopifyId}` },
  );
  return data.product;
}

export async function updateShopifyProduct(
  shopifyId: string,
  fields: {
    title?: string;
    descriptionHtml?: string;
    productType?: string | null;
    vendor?: string | null;
    status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  },
): Promise<{ status: string }> {
  const product: Record<string, unknown> = { id: `gid://shopify/Product/${shopifyId}` };
  if (fields.title != null) product.title = fields.title;
  if (fields.descriptionHtml != null) product.descriptionHtml = fields.descriptionHtml;
  if (fields.productType != null) product.productType = fields.productType;
  if (fields.vendor != null) product.vendor = fields.vendor;
  if (fields.status != null) product.status = fields.status;

  const data = await shopifyGraphql<{
    productUpdate: {
      product: { status: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `mutation UpdateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { status }
        userErrors { field message }
      }
    }`,
    { product },
  );

  const errs = data.productUpdate.userErrors;
  if (errs?.length) {
    throw new Error(errs.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join(" · "));
  }
  return { status: data.productUpdate.product?.status ?? fields.status ?? "ACTIVE" };
}
