"use client";

import { Dropdown } from "@/components/Dropdown";
import type { DeliveryNoteType } from "@/lib/delivery-notes";

export type NewOperationType = "sale" | Exclude<DeliveryNoteType, "delivery">;

const OPERATION_LABEL: Record<NewOperationType, string> = {
  sale: "Venta",
  loan: "Préstamo",
  quote: "Presupuesto",
};

const OPERATION_OPTIONS = Object.values(OPERATION_LABEL);

function operationFromLabel(label: string): NewOperationType {
  const entry = Object.entries(OPERATION_LABEL).find(([, value]) => value === label);
  return (entry?.[0] as NewOperationType | undefined) ?? "sale";
}

export function OperationTypePicker({
  value,
  onChange,
}: {
  value: NewOperationType;
  onChange: (value: NewOperationType) => void;
}) {
  return (
    <div className="w-[210px] text-left">
      <Dropdown
        label="TIPO DE OPERACIÓN"
        value={OPERATION_LABEL[value]}
        options={OPERATION_OPTIONS}
        onChange={(label) => onChange(operationFromLabel(label))}
      />
    </div>
  );
}
