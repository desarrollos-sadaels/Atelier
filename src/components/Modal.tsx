"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/icons";
import { cn } from "@/lib/cn";

// Mismo truco que `Popover`: el portal necesita `document.body`, que no existe
// en el SSR. `useSyncExternalStore` devuelve false en el server y true en el
// cliente sin un efecto que setee estado.
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Diálogo modal. Lo usan la edición de una venta, la devolución y el cambio:
 * las tres son operaciones sobre una fila de la grilla y sacar al vendedor a
 * otra pantalla le hace perder de vista qué venta estaba tocando.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
}) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Sin esto la página de atrás scrollea bajo el diálogo, que en una tabla
    // larga hace perder el lugar al cerrar.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-ink/25 p-4 py-10 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        // Solo el click en el fondo cierra: si empezó adentro del panel (por
        // ejemplo, arrastrando para seleccionar texto) no debe cerrarse.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "animate-pop w-full rounded-[6px] border border-line2 bg-bg shadow-[0_24px_70px_-20px_rgba(0,0,0,0.35)] outline-none",
          width === "lg" ? "max-w-[720px]" : "max-w-[520px]",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="font-serif text-[22px] leading-tight tracking-tight">{title}</h2>
            {subtitle && <div className="mono mt-1.5 text-[11px] text-mut">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="mt-0.5 shrink-0 rounded-full p-1 text-mut hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2.5 border-t border-line px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
