"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type Coords = { top: number; left?: number; right?: number };

export function Popover({
  trigger,
  triggerClass,
  children,
  align = "left",
  panelClass,
}: {
  trigger: ReactNode;
  triggerClass?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  panelClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<Coords>({ top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords(
        align === "right"
          ? { top: r.bottom + 8, right: window.innerWidth - r.right }
          : { top: r.bottom + 8, left: r.left },
      );
    };
    place();

    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Cerrar al scrollear la página, pero NO si el scroll ocurre dentro del panel.
    const onScroll = (e: Event) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, align]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
        aria-expanded={open}
      >
        {trigger}
      </button>
      {mounted &&
        open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, right: coords.right }}
            className={cn(
              "animate-pop z-[100] rounded-[6px] border border-line2 bg-bg shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)]",
              align === "right" ? "origin-top-right" : "origin-top-left",
              panelClass,
            )}
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}
