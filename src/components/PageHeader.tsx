import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui";

export function PageHeader({
  kicker,
  title,
  actions,
}: {
  kicker: string;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 pt-9 pb-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div>
        <Eyebrow className="mb-3">{kicker}</Eyebrow>
        <h1 className="font-serif text-[32px] leading-none tracking-tight sm:text-[46px]">
          {title}
        </h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 pb-1">{actions}</div>}
    </div>
  );
}
