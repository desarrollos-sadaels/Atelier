import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ---------- Button (pill) ---------- */
type BtnVariant = "primary" | "dark" | "ghost";
const BTN_STYLES: Record<BtnVariant, string> = {
  primary: "bg-acc text-white hover:bg-acc-dark",
  dark: "bg-ink text-white hover:opacity-90",
  ghost: "bg-bg text-ink border border-line2 hover:border-ink/40",
};

export function btnCls(variant: BtnVariant = "dark", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 text-[13px] font-medium cursor-pointer transition duration-150 active:scale-[0.97]",
    BTN_STYLES[variant],
    className,
  );
}

export function Button({
  children,
  variant = "dark",
  className,
  ...rest
}: {
  children: ReactNode;
  variant?: BtnVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={btnCls(variant, className)} {...rest}>
      {children}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[4px] border border-line bg-bg",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mono text-[11px] text-mut px-6 pt-6">{children}</div>
  );
}

/* ---------- Eyebrow / kicker ---------- */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mono text-[11px] text-mut", className)}>{children}</div>
  );
}

/* ---------- Chip ---------- */
export function Chip({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "acc";
}) {
  return (
    <span
      className={cn(
        "mono inline-flex items-center rounded-full px-2.5 py-1 text-[10px]",
        tone === "acc"
          ? "bg-acc text-white"
          : "border border-line2 text-mut bg-bg",
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Status dot ---------- */
export function Dot({ alert = false }: { alert?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full shrink-0",
        alert ? "bg-acc" : "border-[1.4px] border-ink",
      )}
    />
  );
}
