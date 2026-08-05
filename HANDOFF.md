# Handoff: mover Atelier a cuentas nuevas

Guía para migrar el proyecto a una cuenta nueva de **Supabase**, **Vercel** y **GitHub**.

Estado verificado el 2026-08-05 contra los proyectos en producción. Lo que dice
este documento salió de consultar la base y la API de Vercel, no de leer el repo.

---

## 0. Lo que NO hace falta limpiar

- **No hay secretos en la historia de git.** El único archivo de entorno que se
  commiteó alguna vez es `.env.example` (sin valores). `.gitignore` cubre
  `.env*`, `.vercel` y `*.pem`. El repo se puede transferir tal cual, sin
  reescribir historia.

---

## 1. Supabase

Proyecto actual: `ypewoopesortnpmqzgvx` (sadaels-stock-atelier), región `us-west-2`.

### 1.1 Schema — hay drift entre el repo y la base

`supabase/migrations/` **no es un espejo exacto** de lo aplicado en producción.
Ambos tienen 13 migraciones, pero no son el mismo conjunto:

| | En el repo | En el ledger de la DB |
|---|---|---|
| `harden_rls` | ❌ no existe | ✅ aplicada (2026-06-26) |
| `0003_product_image` | ✅ existe | ❌ no figura |

Por qué igual se puede migrar desde el repo:

- `0012_rls_realign_roles` fija el estado final de las policies con
  `DROP` + `CREATE` idempotente, así que llegar sin `harden_rls` produce las
  mismas policies que producción.
- `0003_product_image` es `add column if not exists`, idempotente y además
  superado por `0004_product_images_array`.

**Verificá igual el resultado**: después de correr las migraciones en el proyecto
nuevo, comparar las policies de `products`, `campaigns`, `notifications`,
`product_campaign_links` y `automation_rules` contra las de producción antes de
mandar datos.

### 1.2 Storage

Los dos buckets los crean migraciones — no hay que crearlos a mano:

- `product-images` — público (`0005_product_images_bucket`)
- `invoices` — privado (`0007_sales_invoice_installments`)

Los **archivos** dentro de los buckets no se migran solos. `storage.objects`
tenía 0 filas al momento de escribir esto, así que probablemente no haya nada que
copiar, pero confirmalo antes de dar de baja el proyecto viejo.

### 1.3 Datos a migrar

| Tabla | Filas |
|---|---|
| `products` | 382 |
| `notifications` | 52 |
| `profiles` | 4 |
| `app_settings` | 2 |
| `invitations` | 1 |
| `sales`, `campaigns`, `product_campaign_links`, `automation_rules` | 0 |

### 1.4 Lo que las migraciones NO capturan (config manual en el proyecto nuevo)

- **Provider de Google**: client ID + secret, en Authentication → Providers.
- **Site URL** y **Redirect URLs**: tienen que apuntar al dominio nuevo, con
  `/auth/callback`. Si falta, el login con Google no entra.
- **Usuarios de `auth.users`** (4). No se migran con las migraciones, y
  `profiles.id` es FK a `auth.users.id`: en el proyecto nuevo los usuarios van a
  tener **IDs distintos**. Lo más simple es que cada uno vuelva a loguear con
  Google y reasignarles el rol a mano (o precargar `invitations`, que aplica el
  rol en el primer login — ver `src/app/auth/callback/route.ts`).

---

## 2. Vercel

Proyecto actual: `atelier` en el team `luziferbula-projects`.

- **Cron** (`vercel.json`): `/api/cron/daily-summary`, schedule `10 3 * * *`.
  Se recrea solo con el deploy, pero necesita `CRON_SECRET`.
- **Dominio**: `atelier.sadaels.com`. Hay que moverlo o reemplazarlo.
- **Deployment Protection**: hoy `ssoProtection` en `all_except_custom_domains`
  (el dominio propio es público, las URLs de preview piden login de Vercel).
- **Región de funciones**: hoy `iad1` (Virginia), con la base en `us-west-2`
  (Oregon). Cada viaje a Supabase cruza el país. Al crear el proyecto nuevo
  conviene **co-locar función y base en la misma región**.

### Variables de entorno

`.env.example` documenta todas con su descripción. Ojo con estas, que **no están
en `.env.local`** y por lo tanto se olvidan fácil:

- `NEXT_PUBLIC_APP_URL` — ver el punto 4, es la más peligrosa.
- `SYNC_SECRET` — sin ella, `/api/shopify/sync` y `/api/shopify/register-webhooks`
  devuelven 401 en los deploys.
- `CRON_SECRET` — protege el resumen diario.
- `AI_GATEWAY_API_KEY` — la usa el agente de Learnings.
- `LEARNINGS_ENABLED` — dejar sin setear (o distinto de `"true"`) para que el
  feature nazca apagado en la cuenta nueva.

---

## 3. Servicios externos a reapuntar

Ninguno de estos vive en el repo. Todos apuntan hoy a las cuentas viejas:

- **Google Cloud Console** — el OAuth client tiene como redirect autorizado la
  URL del proyecto Supabase **viejo**. Hay que agregar la del nuevo.
- **Shopify** — los webhooks registrados apuntan al dominio de Vercel **viejo**.
  Se re-registran llamando a `POST /api/shopify/register-webhooks` (con
  `SYNC_SECRET`) una vez que el deploy nuevo esté arriba.
- **Meta Ads** — app + token de System User. La cuenta publicitaria es
  `205681188375750` (business Lanzallamas SRL). Si la app de Meta queda en el
  Business viejo, hay que decidir si se transfiere o se crea una nueva.
- **Resend** — `RESEND_FROM` tiene que ser de un dominio verificado en la cuenta
  de Resend que se use.

---

## 4. Landmine conocida en el código

`src/app/api/users/invite/route.ts:7`

```ts
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://atelier-six-iota.vercel.app";
```

El fallback apunta a un alias del deploy **viejo**. Si en la cuenta nueva no se
setea `NEXT_PUBLIC_APP_URL`, los emails de invitación van a linkear al deploy
viejo — y como no falla ni tira error, se descubre recién cuando un invitado
hace clic y aterriza en la app de otra cuenta.

Dos opciones: setear `NEXT_PUBLIC_APP_URL` siempre, o sacar el fallback para que
falle fuerte.

---

## 5. Orden sugerido

1. Crear proyecto Supabase nuevo (misma región que se vaya a usar en Vercel).
2. Correr las migraciones del repo y **verificar policies** contra producción (1.1).
3. Configurar Auth: provider de Google + Site URL + Redirect URLs (1.4).
4. Migrar datos (1.3). Dejar `profiles` para el final, después de que los
   usuarios existan.
5. Transferir el repo de GitHub (o crear uno nuevo y pushear).
6. Crear proyecto en Vercel, conectar el repo, cargar **todas** las env vars.
7. Deployar y apuntar el dominio.
8. Re-registrar webhooks de Shopify y reapuntar el redirect de Google (3).
9. Probar el login con Google de punta a punta antes de dar de baja lo viejo.
