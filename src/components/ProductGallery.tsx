"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronLeft } from "@/components/icons";

export function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const [i, setI] = useState(0);

  if (images.length === 0) {
    return (
      <div className="grid h-[480px] place-items-center rounded-[4px] border border-line2 bg-tile">
        <span className="mono text-[11px] text-mut2">Sin imagen</span>
      </div>
    );
  }

  const multiple = images.length > 1;
  const current = Math.min(i, images.length - 1);
  const prev = () => setI((p) => (p - 1 + images.length) % images.length);
  const next = () => setI((p) => (p + 1) % images.length);

  return (
    <div>
      <div className="relative h-[480px] overflow-hidden rounded-[4px] border border-line2 bg-panel">
        <Image
          src={images[current]}
          alt={alt}
          fill
          sizes="(max-width: 1024px) 100vw, 480px"
          className="object-contain"
          priority
        />
        {multiple && (
          <>
            <button
              onClick={prev}
              aria-label="Imagen anterior"
              className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line2 bg-bg/90 text-ink backdrop-blur hover:border-ink/40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={next}
              aria-label="Imagen siguiente"
              className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line2 bg-bg/90 text-ink backdrop-blur hover:border-ink/40"
            >
              <ChevronLeft className="h-4 w-4 rotate-180" />
            </button>
            <div className="mono absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] text-white">
              {current + 1} / {images.length}
            </div>
          </>
        )}
      </div>

      {multiple && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {images.map((src, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Ver imagen ${idx + 1}`}
              className={cn(
                "relative h-16 w-16 overflow-hidden rounded-[4px] border transition-colors",
                idx === current ? "border-ink" : "border-line2 hover:border-ink/40",
              )}
            >
              <Image src={src} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
