# Configuración de Supabase + Vercel

La app funciona sin Supabase (sólo OpenF1), pero el caché Supabase elimina los HTTP 429 al evitar re-descargar sesiones ya cargadas previamente. Las sesiones de F1 son inmutables: una vez disputadas y descargadas, no cambian.

## 1. Crear proyecto Supabase

1. Entrar en https://supabase.com → "New project".
2. Elegir nombre, contraseña (no se usa, sólo para postgres) y región.
3. Esperar ~2 minutos a que se aprovisione.

## 2. Aplicar el esquema

En el dashboard del proyecto → **SQL Editor** → "New query" → pegar y ejecutar:

```sql
create table if not exists public.cached_sessions (
  session_key bigint primary key,
  year int not null,
  round int not null,
  session_type text not null,
  session_name text not null,
  circuit_id text not null,
  cached_at timestamptz not null default now()
);

create table if not exists public.cached_drivers (
  session_key bigint not null references public.cached_sessions(session_key) on delete cascade,
  driver_number int not null,
  full_name text not null,
  team_name text not null,
  team_color text,
  primary key (session_key, driver_number)
);

create table if not exists public.cached_laps (
  session_key bigint not null references public.cached_sessions(session_key) on delete cascade,
  driver_number int not null,
  lap_number int not null,
  lap_data jsonb not null,
  primary key (session_key, driver_number, lap_number)
);

create table if not exists public.cached_telemetry (
  session_key bigint not null,
  driver_number int not null,
  points jsonb not null,
  primary key (session_key, driver_number)
);

create table if not exists public.cached_weather (
  session_key bigint primary key,
  summary jsonb not null
);

create table if not exists public.cached_circuits (
  circuit_id text primary key,
  data jsonb not null,
  cached_at timestamptz not null default now()
);

alter table public.cached_sessions  enable row level security;
alter table public.cached_drivers   enable row level security;
alter table public.cached_laps      enable row level security;
alter table public.cached_telemetry enable row level security;
alter table public.cached_weather   enable row level security;
alter table public.cached_circuits  enable row level security;

create policy "public read"  on public.cached_sessions  for select using (true);
create policy "public write" on public.cached_sessions  for insert with check (true);
create policy "public read"  on public.cached_drivers   for select using (true);
create policy "public write" on public.cached_drivers   for insert with check (true);
create policy "public read"  on public.cached_laps      for select using (true);
create policy "public write" on public.cached_laps      for insert with check (true);
create policy "public read"  on public.cached_telemetry for select using (true);
create policy "public write" on public.cached_telemetry for insert with check (true);
create policy "public read"  on public.cached_weather   for select using (true);
create policy "public write" on public.cached_weather   for insert with check (true);
create policy "public read"  on public.cached_circuits  for select using (true);
create policy "public write" on public.cached_circuits  for insert with check (true);

create index if not exists idx_laps_session_driver on public.cached_laps (session_key, driver_number);
```

Datos públicos de F1, sin PII; RLS abierta es aceptable. Si quieres restringir escritura a usuarios autenticados en el futuro, ajusta las policies de `for insert`.

## 3. Copiar credenciales

En el dashboard del proyecto → **Project Settings → API**:
- `Project URL` → `VITE_SUPABASE_URL`
- `anon public` key → `VITE_SUPABASE_ANON_KEY`

## 4. Configurar localmente (dev)

Crear `.env.local` en la raíz del proyecto:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJI...
```

`.env.local` ya está ignorado por Git por defecto en proyectos Vite.

`npm run dev` y verifica en DevTools → Network que la primera descarga golpea `api.openf1.org` y la segunda (tras recargar) golpea `xxxxx.supabase.co` y termina al instante.

## 5. Configurar en Vercel (producción)

1. Importar el repo en Vercel.
2. Vercel detecta automáticamente Vite. El `vercel.json` ya fija `framework`, `buildCommand` y `outputDirectory`.
3. **Project Settings → Environment Variables**, añadir:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   Marcar las dos para **Production** y **Preview**.
4. Deploy.

## Sin Supabase

Si las dos variables no están definidas, la app funciona igualmente: cada sesión se descarga desde OpenF1. La diferencia es que cada visita paga el coste de OpenF1 desde cero.
