"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  placeholder,
  className,
  ...rest
}: {
  label: string;
  placeholder?: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("block", className)}>
      <span className="mono text-[10px] text-mut">{label}</span>
      <input
        placeholder={placeholder}
        className="mt-2 h-11 w-full rounded-lg border border-line2 px-3.5 text-[13px] outline-none placeholder:text-mut focus:border-ink/40"
        {...rest}
      />
    </label>
  );
}

export function Textarea({
  label,
  placeholder,
  ...rest
}: {
  label: string;
  placeholder?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="mono text-[10px] text-mut">{label}</span>
      <textarea
        placeholder={placeholder}
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border border-line2 px-3.5 py-2.5 text-[13px] outline-none placeholder:text-mut focus:border-ink/40"
        {...rest}
      />
    </label>
  );
}

export function Toggle({
  defaultOn = false,
  on,
  onChange,
}: {
  defaultOn?: boolean;
  on?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [internal, setInternal] = useState(defaultOn);
  const isOn = on ?? internal;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      onClick={() => {
        const next = !isOn;
        if (on === undefined) setInternal(next);
        onChange?.(next);
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        isOn ? "bg-acc" : "border border-line2 bg-bg",
      )}
    >
      <span
        className={cn(
          "inline-block h-[18px] w-[18px] rounded-full transition-transform",
          isOn ? "translate-x-[22px] bg-white" : "translate-x-[3px] bg-mut2",
        )}
      />
    </button>
  );
}

export function ToggleRow({
  title,
  sub,
  defaultOn,
  on,
  onChange,
}: {
  title: string;
  sub?: string;
  defaultOn?: boolean;
  on?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-[14px] font-medium">{title}</div>
        {sub && <div className="text-[11px] text-mut">{sub}</div>}
      </div>
      <Toggle defaultOn={defaultOn} on={on} onChange={onChange} />
    </div>
  );
}
