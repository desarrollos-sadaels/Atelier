export type UiProduct = {
  id: string;
  name: string;
  sku: string;
  cat: string;
  price: string;
  stock: string;
  out: boolean;
  shopify: string;
  meta: string;
  metaState: "a" | "p" | "n";
  image: string | null;
  stockNum: number;
  alertThreshold: number;
};
