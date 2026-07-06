"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardTitle, Chip, btnCls } from "@/components/ui";
import { Field, ToggleRow } from "@/components/forms";
import { Plus, X } from "@/components/icons";
import { Dropdown } from "@/components/Dropdown";
import { Toggle } from "@/components/forms";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ROLE_LABEL, ROLES, normalizeRole, type Role } from "@/lib/roles";
import { parsePaymentMethods, DEFAULT_PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments";
import { cn } from "@/lib/cn";

type UserRow = { id: string; name: string; email: string; role: Role };

const ROLE_BY_LABEL: Record<string, Role> = Object.fromEntries(
  ROLES.map((r) => [ROLE_LABEL[r], r]),
) as Record<string, Role>;

const TABS = [
  "Cuenta",
  "Ventas",
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
  const [methods, setMethods] = useState<PaymentMethod[]>(DEFAULT_PAYMENT_METHODS);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id,full_name,email,role")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setUsers(
          (data ?? []).map((p) => ({
            id: p.id,
            name: p.full_name || p.email || "—",
            email: p.email || "—",
            role: normalizeRole(p.role),
          })),
        );
      });
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "payment_methods")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setMethods(parsePaymentMethods(data.value));
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
          {tab === "Ventas" && <PagosSettingsPanel initial={methods} />}
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
  const [rows, setRows] = useState(users);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setRows(users), [users]);

  async function changeRole(user: UserRow, label: string) {
    const role = ROLE_BY_LABEL[label];
    if (!role || role === user.role || busy) return;
    setBusy(user.id);
    try {
      const res = await fetch("/api/users/role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, role }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo cambiar el rol");
      setRows((cur) => cur.map((u) => (u.id === user.id ? { ...u, role } : u)));
      toast.success(`${user.name} ahora es ${ROLE_LABEL[role]}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el rol");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between px-6 pt-6">
        <span className="mono text-[11px] text-mut">Usuarios y permisos</span>
        <button
          className={btnCls("primary", "h-9 text-[12px]")}
          onClick={() =>
            toast("Invitar usuario", {
              description: "Compartile el link de la app: entra con Google y queda como Vendedor.",
            })
          }
        >
          <Plus className="h-4 w-4" /> Invitar usuario
        </button>
      </div>
      <div className="px-6 pb-6">
        {rows.length === 0 ? (
          <p className="mt-6 text-[13px] text-mut">
            Todavía no hay usuarios. Aparecen al iniciar sesión por primera vez.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-4 w-full min-w-[560px] text-left">
              <thead>
                <tr className="mono text-[9px] text-mut2">
                  {["Usuario", "Email", "Rol", "Estado"].map((h, i) => (
                    <th key={i} className="border-b border-line py-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-b border-line">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <span className="h-10 w-10 rounded-full border border-line2 bg-tile" />
                        <span className="text-[14px] font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="mono text-[12px] text-mut">{u.email}</td>
                    <td className={cn("pr-4", busy === u.id && "pointer-events-none opacity-50")}>
                      <Dropdown
                        value={ROLE_LABEL[u.role]}
                        options={ROLES.map((r) => ROLE_LABEL[r])}
                        onChange={(label) => changeRole(u, label)}
                        variant="pill"
                      />
                    </td>
                    <td>
                      <Chip tone="default">Activa</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mono mt-5 text-[11px] text-mut">
              {rows.length} usuario{rows.length === 1 ? "" : "s"} · Los nuevos ingresan como
              Vendedor
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PagosSettingsPanel({ initial }: { initial: PaymentMethod[] }) {
  const [methods, setMethods] = useState<PaymentMethod[]>(initial);
  const [newName, setNewName] = useState("");
  const [newCuotas, setNewCuotas] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setMethods(initial), [initial]);

  const update = (i: number, patch: Partial<PaymentMethod>) =>
    setMethods((cur) => cur.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  function addMethod() {
    const name = newName.trim().toUpperCase();
    if (!name) return toast.error("Ingresá el nombre del método");
    if (methods.some((m) => m.name.toUpperCase() === name)) return toast.error("Ese método ya existe");
    setMethods((cur) => [...cur, { name, installments: newCuotas ? [1] : null }]);
    setNewName("");
    setNewCuotas(false);
  }

  async function save() {
    if (saving) return;
    if (!methods.length) return toast.error("Dejá al menos un método de pago");
    setSaving(true);
    const t = toast.loading("Guardando métodos de pago…");
    try {
      const res = await fetch("/api/settings/payment-methods", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ methods }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      setMethods(data.methods);
      toast.success("Métodos de pago actualizados", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar", { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between px-6 pt-6">
        <span className="mono text-[11px] text-mut">Métodos de pago y cuotas</span>
        <button className={btnCls("primary", "h-9 text-[12px]")} disabled={saving} onClick={save}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      <div className="px-6 pb-6 pt-2">
        <p className="text-[13px] text-mut">
          Definí los métodos disponibles al registrar una venta. Los que cobran en cuotas
          (ej. Tarjeta, Mercado Pago) muestran su propio selector de cuotas.
        </p>

        <div className="mt-5 space-y-3">
          {methods.map((m, i) => (
            <div key={i} className="rounded-lg border border-line2 p-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-[14px] font-medium">{m.name}</span>
                <span className="mono text-[10px] text-mut">Cobra en cuotas</span>
                <Toggle
                  on={m.installments !== null}
                  onChange={(on) => update(i, { installments: on ? m.installments ?? [1, 3, 6, 12] : null })}
                />
                <button
                  onClick={() => setMethods((cur) => cur.filter((_, idx) => idx !== i))}
                  className="grid h-6 w-6 place-items-center rounded-full border border-line2 text-mut hover:border-acc hover:text-acc"
                  aria-label={`Quitar ${m.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {m.installments !== null && (
                <CuotasEditor
                  value={m.installments}
                  onChange={(list) => update(i, { installments: list })}
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-end gap-3 border-t border-line pt-5">
          <div className="flex-1">
            <Field
              label="NUEVO MÉTODO"
              placeholder="Ej: DÓLARES"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addMethod();
                }
              }}
            />
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <span className="mono text-[10px] text-mut">EN CUOTAS</span>
            <Toggle on={newCuotas} onChange={setNewCuotas} />
          </div>
          <button className={btnCls("ghost", "h-11")} onClick={addMethod}>
            <Plus className="h-4 w-4" /> Agregar
          </button>
        </div>
      </div>
    </Card>
  );
}

function CuotasEditor({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [input, setInput] = useState("");
  function add() {
    const n = Math.trunc(Number(input));
    if (!Number.isFinite(n) || n <= 0 || n > 60) return toast.error("Cuotas inválidas (1–60)");
    if (value.includes(n)) return;
    onChange([...value, n].sort((a, b) => a - b));
    setInput("");
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {value.map((n) => (
        <span
          key={n}
          className="mono flex items-center gap-1.5 rounded-full border border-line2 py-1 pl-2.5 pr-1 text-[11px]"
        >
          {n}
          <button
            onClick={() => onChange(value.filter((x) => x !== n))}
            className="grid h-4 w-4 place-items-center rounded-full bg-ink text-[8px] text-white"
            aria-label={`Quitar ${n}`}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        type="number"
        min={1}
        max={60}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="+ cuota"
        className="mono h-8 w-20 rounded-full border border-line2 px-3 text-[11px] outline-none focus:border-ink/40"
      />
    </div>
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
