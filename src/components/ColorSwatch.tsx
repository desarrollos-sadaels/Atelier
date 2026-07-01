"use client";

import { colorToHex, isLightColor } from "@/lib/colors";
import { cn } from "@/lib/cn";
import { Check } from "@/components/icons";

const SIZES = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-8 w-8" } as const;

export function ColorSwatch({
  name,
  size = "md",
  selected = false,
  muted = false,
  onClick,
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  selected?: boolean;
  muted?: boolean; // sin stock → atenuado con tachado
  onClick?: () => void;
  className?: string;
}) {
  const hex = colorToHex(name);
  const light = hex ? isLightColor(hex) : true;
  const interactive = Boolean(onClick);

  const circle = (
    <span
      className={cn(
        "relative grid place-items-center rounded-full transition-transform",
        SIZES[size],
        light ? "border border-line2" : "border border-black/10",
        selected && "ring-2 ring-ink ring-offset-2 ring-offset-bg",
        interactive && "hover:scale-110",
        muted && "opacity-35",
      )}
      style={hex ? { backgroundColor: hex } : undefined}
      title={name}
    >
      {!hex && (
        <span className="text-[8px] font-medium uppercase text-mut2">
          {name.slice(0, 1)}
        </span>
      )}
      {selected && hex && (
        <Check className={cn("h-3 w-3", light ? "text-ink" : "text-white")} />
      )}
      {muted && (
        <span className="absolute h-px w-full rotate-45 bg-acc/70" aria-hidden />
      )}
    </span>
  );

  if (!interactive) return <span className={className}>{circle}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={name}
      className={cn("inline-flex", className)}
    >
      {circle}
    </button>
  );
}
