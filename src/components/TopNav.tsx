"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Popover } from "@/components/Popover";
import { Search, Bell, Menu } from "@/components/icons";
import { Dot } from "@/components/ui";
import { navForRole, ROLE_LABEL, type Role } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { NotificationItem } from "@/lib/queries";

type NavProfile = {
  name: string;
  email: string;
  role: Role;
} | null;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `${d} d`;
}

export function TopNav({
  profile,
  initialNotifications = [],
  initialUnread = 0,
}: {
  profile?: NavProfile;
  initialNotifications?: NotificationItem[];
  initialUnread?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationItem[]>(initialNotifications);
  const [unread, setUnread] = useState(initialUnread);

  const role: Role = profile?.role ?? "admin"; // modo demo (sin auth): nav completa
  const nav = navForRole(role);

  // Realtime: nuevas notificaciones aparecen sin recargar.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as NotificationItem & { created_at: string };
          setNotifs((cur) =>
            [
              {
                id: n.id,
                type: n.type,
                title: n.title,
                body: n.body,
                severity: n.severity,
                read: n.read,
                createdAt: n.created_at,
              },
              ...cur,
            ].slice(0, 8),
          );
          setUnread((c) => c + 1);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function markRead() {
    if (unread === 0) return;
    setUnread(0);
    setNotifs((cur) => cur.map((n) => ({ ...n, read: true })));
    if (!isSupabaseConfigured()) return;
    try {
      await createClient().from("notifications").update({ read: true }).eq("read", false);
    } catch {
      /* no-op: el conteo visual ya se actualizó */
    }
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(query ? `/catalogo?q=${encodeURIComponent(query)}` : "/catalogo");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center px-5 md:px-10">
        <Link
          href={nav[0]?.href ?? "/catalogo"}
          className="font-serif text-[22px] font-semibold tracking-tight"
        >
          Atelier
        </Link>

        <nav className="ml-16 hidden items-center gap-10 lg:flex">
          {nav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative font-serif text-[16px] transition-colors",
                  active ? "text-ink font-medium" : "text-mut hover:text-ink",
                )}
              >
                {item.label}
                <span
                  className={cn(
                    "absolute -bottom-[26px] left-0 h-0.5 w-full origin-left bg-acc transition-transform duration-300 ease-out",
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <form
            onSubmit={submitSearch}
            className="hidden h-9 w-[180px] items-center gap-2 rounded-full border border-line2 px-3 text-mut focus-within:border-ink/40 md:flex"
          >
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="mono w-full bg-transparent text-[11px] uppercase tracking-wider text-ink outline-none placeholder:text-mut"
            />
          </form>

          {/* notifications */}
          <Popover
            align="right"
            triggerClass="relative grid h-9 w-9 place-items-center rounded-full border border-line2 text-ink hover:border-ink/40"
            trigger={
              <>
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-acc px-1 text-[9px] font-semibold text-white ring-2 ring-bg">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </>
            }
            panelClass="w-[360px] p-0"
          >
            {(close) => (
              <div>
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <span className="mono text-[11px] text-mut">
                    Notificaciones{unread > 0 ? ` · ${unread} sin leer` : ""}
                  </span>
                  <button
                    onClick={markRead}
                    disabled={unread === 0}
                    className="mono text-[10px] text-mut hover:text-ink disabled:opacity-40"
                  >
                    Marcar leídas
                  </button>
                </div>
                {notifs.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="mono text-[11px] text-mut">Sin notificaciones todavía</p>
                  </div>
                ) : (
                  <ul>
                    {notifs.map((n) => (
                      <li
                        key={n.id}
                        className={cn(
                          "flex gap-3 border-b border-line px-4 py-3 last:border-0",
                          !n.read && "bg-acc/[0.03]",
                        )}
                      >
                        <span className="mt-1.5">
                          <Dot alert={n.severity === "alert"} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-semibold">{n.title}</span>
                            <span className="mono text-[10px] text-mut">{timeAgo(n.createdAt)}</span>
                          </div>
                          {n.body && <p className="text-[11px] leading-snug text-mut">{n.body}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href="/dashboard"
                  onClick={close}
                  className="mono block px-4 py-3 text-center text-[11px] text-acc hover:bg-panel"
                >
                  Ver actividad completa
                </Link>
              </div>
            )}
          </Popover>

          {/* user menu */}
          <Popover
            align="right"
            triggerClass="h-9 w-9 rounded-full border border-line2 bg-tile hover:border-ink/40"
            trigger={<span className="sr-only">Usuario</span>}
            panelClass="w-[230px] p-1.5"
          >
            {(close) => (
              <div>
                <div className="border-b border-line px-3 py-2.5">
                  <div className="truncate text-[13px] font-medium">
                    {profile?.name ?? "Invitado"}
                  </div>
                  <div className="mono truncate text-[10px] text-mut">
                    {profile ? `${ROLE_LABEL[role]} · ${profile.email}` : "Modo demo"}
                  </div>
                </div>
                <div className="pt-1.5">
                  {role === "admin" && (
                    <Link
                      href="/configuracion"
                      onClick={close}
                      className="block rounded-md px-3 py-2 text-[13px] text-ink2 hover:bg-panel"
                    >
                      Configuración
                    </Link>
                  )}
                  <form action="/auth/signout" method="post">
                    <button
                      type="submit"
                      onClick={close}
                      className="block w-full rounded-md px-3 py-2 text-left text-[13px] text-acc hover:bg-panel"
                    >
                      Cerrar sesión
                    </button>
                  </form>
                </div>
              </div>
            )}
          </Popover>

          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-full border border-line2 text-ink lg:hidden"
            aria-label="Menú"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* mobile drawer */}
      {mobileOpen && (
        <nav className="border-t border-line px-5 py-3 lg:hidden">
          {nav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "block rounded-md px-3 py-2.5 font-serif text-[18px]",
                  active ? "text-acc" : "text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
