import { Chevron } from "@/components/icons";

export function FilterPill({ label }: { label: string }) {
  return (
    <button className="mono flex items-center gap-2 rounded-full border border-line2 px-3.5 py-2 text-[11px] text-ink2">
      {label}
      <Chevron className="h-3 w-3 text-mut" />
    </button>
  );
}
