"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardTitle, Chip, btnCls } from "@/components/ui";
import { Field, ToggleRow } from "@/components/forms";
import { Plus, Dots } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { cn } from "@/lib/cn";

type UserRow = { name: string; email: string; role: string };

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  media: "Media Manager",
  pauta: "Pauta",
  compras: "Compras",
  viewer: "Solo lectura",
};

const TABS = [
  "Cuenta",
  "Integraciones",
  "Notificaciones",
  "Usuarios y permisos",
  "Facturación",
  "Seguridad",
];

const integrations = [
  ["Shopify", "mi-tienda.myshopify.com", "Conectado"],
  ["Meta Ads", "Lanzallamas · act_1029384", "Conectado"],
  ["Google (SSO)", "Workspace lanzallamas.tv", "Conectado"],
  ["Slack", "#stock-alertas", "Conectado"],
];

export default function ConfiguracionPage() {
  const [tab, setTab] = useState("Usuarios y permisos");
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("full_name,email,role")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setUsers(
          (data ?? []).map((p) => ({
            name: p.full_name || p.email || "—",
            email: p.email || "—",
            role: ROLE_LABEL[p.role] ?? p.role,
          })),
        );
      });
  }, []);

  return (
    <>
      <PageHeader kicker="Ajustes" title="Configuración" />

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        {/* subnav */}
        <Card className="h-max py-3">
          {TABS.map((s) => {
            const active = s === tab;
            return (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={cn(
                  "relative mx-3 flex w-[calc(100%-24px)] items-center rounded-lg px-4 py-2.5 text-left text-[14px]",
                  active ? "bg-panel font-medium text-ink" : "text-mut hover:text-ink",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded bg-acc" />
                )}
                {s}
              </button>
            );
          })}
        </Card>

        {/* panel */}
        <div>
          {tab === "Usuarios y permisos" && <UsuariosPanel users={users} />}
          {tab === "Cuenta" && <CuentaPanel />}
          {tab === "Integraciones" && <IntegracionesPanel />}
          {tab === "Notificaciones" && <NotificacionesPanel />}
          {tab === "Facturación" && (
            <Placeholder title="Facturación" text="Plan Pro · próxima factura 01/07/2026 · $—" />
          )}
          {tab === "Seguridad" && <SeguridadPanel />}
        </div>
      </div>
    </>
  );
}

function UsuariosPanel({ users }: { users: UserRow[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between px-6 pt-6">
        <span className="mono text-[11px] text-mut">Usuarios y permisos</span>
        <button
          className={btnCls("primary", "h-9 text-[12px]")}
          onClick={() => toast.success("Invitación enviada")}
        >
          <Plus className="h-4 w-4" /> Invitar usuario
        </button>
      </div>
      <div className="px-6 pb-6">
        {users.length === 0 ? (
          <p className="mt-6 text-[13px] text-mut">
            Todavía no hay usuarios. Aparecen al iniciar sesión por primera vez.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-4 w-full min-w-[560px] text-left">
              <thead>
                <tr className="mono text-[9px] text-mut2">
                  {["Usuario", "Email", "Rol", "Estado", ""].map((h, i) => (
                    <th key={i} className="border-b border-line py-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email} className="border-b border-line">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <span className="h-10 w-10 rounded-full border border-line2 bg-tile" />
                        <span className="text-[14px] font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="mono text-[12px] text-mut">{u.email}</td>
                    <td className="text-[13px] text-ink2">{u.role}</td>
                    <td>
                      <Chip tone="default">Activa</Chip>
                    </td>
                    <td className="text-right">
                      <button className="text-mut2 hover:text-ink" aria-label="Acciones">
                        <Dots className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mono mt-5 text-[11px] text-mut">
              {users.length} usuario{users.length === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function CuentaPanel() {
  return (
    <Card>
      <CardTitle>Cuenta</CardTitle>
      <div className="grid grid-cols-2 gap-4 px-6 pb-2 pt-4">
        <Field label="NOMBRE" defaultValue="Luz Fernández" />
        <Field label="EMAIL" defaultValue="luz@lanzallamas.tv" />
        <Field label="EMPRESA" defaultValue="Lanzallamas" />
        <Field label="ZONA HORARIA" defaultValue="GMT-3 · Buenos Aires" />
      </div>
      <div className="px-6 pb-6 pt-4">
        <button className={btnCls("primary")} onClick={() => toast.success("Cambios guardados")}>
          Guardar cambios
        </button>
      </div>
    </Card>
  );
}

function IntegracionesPanel() {
  return (
    <Card>
      <CardTitle>Integraciones conectadas</CardTitle>
      <div className="px-6 pb-4 pt-2">
        {integrations.map(([name, detail, status]) => (
          <div
            key={name}
            className="flex items-center gap-4 border-b border-line py-4 last:border-0"
          >
            <span className="h-10 w-10 rounded-[6px] border border-line2 bg-tile" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">{name}</div>
              <div className="mono text-[11px] text-mut">{detail}</div>
            </div>
            <Chip>{status}</Chip>
            <button
              className={btnCls("ghost", "h-9 text-[12px]")}
              onClick={() => toast(`${name}`, { description: "Abriendo ajustes…" })}
            >
              Administrar
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NotificacionesPanel() {
  return (
    <Card>
      <CardTitle>Preferencias de notificaciones</CardTitle>
      <div className="divide-y divide-line px-6 pb-4 pt-2">
        <ToggleRow title="Alertas de stock por email" sub="Cuando un producto baja del umbral" defaultOn />
        <ToggleRow title="Push de sin stock" sub="Aviso inmediato al quedar en 0u" defaultOn />
        <ToggleRow title="Resumen diario" sub="Ventas y movimientos del día" />
        <ToggleRow title="Avisos de Meta Ads" sub="Campañas pausadas o reactivadas" defaultOn />
      </div>
    </Card>
  );
}

function SeguridadPanel() {
  return (
    <Card>
      <CardTitle>Seguridad</CardTitle>
      <div className="divide-y divide-line px-6 pb-4 pt-2">
        <ToggleRow title="Verificación en dos pasos" sub="Requerí un segundo factor al iniciar sesión" />
        <ToggleRow title="Cerrar sesión en inactividad" sub="A los 30 minutos sin actividad" defaultOn />
      </div>
      <div className="px-6 pb-6 pt-2">
        <button className={btnCls("ghost")} onClick={() => toast("Sesiones cerradas en otros dispositivos")}>
          Cerrar otras sesiones
        </button>
      </div>
    </Card>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="px-6 pb-8 pt-4 text-[14px] text-mut">{text}</div>
    </Card>
  );
}
