"use client";

import { useState } from "react";
import type { PaymentMethod } from "@/lib/payments";
import type { ExternalBrand } from "@/lib/external-brands";
import type { PickerProduct } from "@/lib/queries";
import type { WholesaleSettings } from "@/lib/wholesale";
import { NuevaVentaClient } from "./NuevaVentaClient";
import { NuevoRemitoClient } from "./NuevoRemitoClient";
import type { NewOperationType } from "./OperationTypePicker";

export function NuevaOperacionClient({
  products,
  sellerName,
  paymentMethods,
  brands,
  wholesaleSettings,
  initialWholesale,
  initialOperationType,
}: {
  products: PickerProduct[];
  sellerName: string;
  paymentMethods: PaymentMethod[];
  brands: ExternalBrand[];
  wholesaleSettings: WholesaleSettings;
  initialWholesale: boolean;
  initialOperationType: NewOperationType;
}) {
  const [operationType, setOperationType] = useState(initialOperationType);

  if (operationType !== "sale") {
    return (
      <NuevoRemitoClient
        products={products}
        brands={brands}
        sellerName={sellerName}
        type={operationType}
        onTypeChange={setOperationType}
      />
    );
  }

  return (
    <NuevaVentaClient
      products={products}
      sellerName={sellerName}
      paymentMethods={paymentMethods}
      brands={brands}
      wholesaleSettings={wholesaleSettings}
      initialWholesale={initialWholesale}
      operationType={operationType}
      onOperationTypeChange={setOperationType}
    />
  );
}
