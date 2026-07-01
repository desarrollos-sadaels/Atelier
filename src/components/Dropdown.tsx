"use client";

import { Popover } from "@/components/Popover";
import { Chevron, Check } from "@/components/icons";
import { cn } from "@/lib/cn";

export function Dropdown({
  label,
  value,
  options,
  onChange,
  variant = "field",
}: {
  label?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  variant?: "field" | "pill";
}) {
  const trigger =
    variant === "pill" ? (
      <span className="mono flex items-center gap-2 rounded-full border border-line2 px-3.5 py-2 text-[11px] text-ink2 hover:border-ink/40">
        {value === options[0] && label ? label : value}
        <Chevron className="h-3 w-3 text-mut" />
      </span>
    ) : (
      <span className="flex h-11 w-full items-center justify-between rounded-lg border border-line2 px-3.5 hover:border-ink/40">
        <span className="text-[13px] text-ink2">{value}</span>
        <Chevron className="h-3.5 w-3.5 text-mut" />
      </span>
    );

  const content = (
    <div className={variant === "field" ? "w-full" : ""}>
      {variant === "field" && label && (
        <span className="mono mb-2 block text-[10px] text-mut">{label}</span>
      )}
      <Popover
        trigger={trigger}
        triggerClass={variant === "field" ? "block w-full text-left" : ""}
        panelClass="min-w-[200px] p-1.5"
      >
        {(close) => (
          <ul className="max-h-72 overflow-auto">
            {options.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    close();
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] hover:bg-panel",
                    opt === value ? "font-medium text-ink" : "text-ink2",
                  )}
                >
                  {opt}
                  {opt === value && <Check className="h-3.5 w-3.5 text-acc" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </div>
  );

  return content;
}
