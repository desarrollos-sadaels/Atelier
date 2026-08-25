import Image from "next/image";
import { GoogleButton } from "@/components/GoogleButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMsg =
    error === "domain"
      ? "Esa cuenta de Google no pertenece al dominio autorizado."
      : error === "auth"
        ? "No pudimos iniciar sesión. Probá de nuevo."
        : null;
  return (
    <div className="flex min-h-screen flex-col">
      {/* promo bar */}
      <div className="flex h-[34px] items-center justify-center overflow-hidden bg-ink px-4">
        <span className="mono truncate text-[10px] tracking-[0.25em] text-white/90">
          Atelier — Inventario en tiempo real — Shopify × Meta Ads — Buenos Aires
        </span>
      </div>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,560px)_1fr]">
        {/* AUTH */}
        <div className="relative flex flex-col px-12 py-10 lg:px-20">
          <span className="font-serif text-[30px] font-semibold tracking-tight">
            Atelier
          </span>

          <div className="my-auto max-w-[460px] py-16">
            {errorMsg && (
              <div className="mb-6 rounded-md border border-acc/30 bg-acc/5 px-4 py-3 text-[13px] text-acc">
                {errorMsg}
              </div>
            )}
            <div
              className="u-rise mono text-[11px] tracking-[0.3em] text-acc"
              style={{ animationDelay: "0.05s" }}
            >
              ✳ Acceso privado
            </div>
            <h1
              className="u-rise mt-5 font-serif text-[58px] leading-[1.02] tracking-tight"
              style={{ animationDelay: "0.12s" }}
            >
              Tu atelier
              <br />
              <span className="italic">de stock.</span>
            </h1>
            <p
              className="u-rise mt-7 max-w-[420px] text-[15px] leading-relaxed text-ink2"
              style={{ animationDelay: "0.2s" }}
            >
              Shopify, Meta Ads y tus reportes de venta en un solo lugar.
              Ingresá con tu cuenta de Google autorizada.
            </p>

            <div className="u-rise" style={{ animationDelay: "0.27s" }}>
              <GoogleButton />
            </div>

            <div className="mt-10 hair" />
            <p className="mono mt-4 text-[10px] tracking-wider text-mut">
              Acceso restringido a miembros del equipo · Términos y Privacidad
            </p>
          </div>

          <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
            <span className="mono text-[10px] tracking-widest text-mut">
              V0.3 — Atelier
            </span>
            <span className="mono text-[10px] tracking-widest text-mut">
              © 2026
            </span>
          </div>
        </div>

        {/* IMAGE */}
        <div className="relative hidden bg-ink lg:block">
          <Image
            src="/model.jpg"
            alt="Editorial Atelier S/S 26"
            fill
            priority
            className="u-fade object-cover object-top"
          />
          <div className="absolute inset-x-0 bottom-0 h-[300px] bg-gradient-to-t from-black/80 to-transparent" />
          <span className="mono absolute right-8 top-8 inline-flex items-center gap-1.5 rounded-full bg-acc px-3 py-1.5 text-[9px] tracking-widest text-white">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" />
            En vivo
          </span>
          <div className="absolute bottom-10 left-10 right-10">
            <div className="mono text-[11px] tracking-[0.3em] text-white/80">
              Editorial — S/S 26
            </div>
            <div className="mt-1 font-serif text-[22px] italic text-white">
              Atelier viste el control de tu inventario.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
