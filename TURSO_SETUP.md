# Configuración de Turso + Vercel

La app funciona sin caché (cada visita re-descarga desde OpenF1). Con Turso conectado, las sesiones ya descargadas por cualquier usuario se sirven instantáneamente desde tu base de datos SQLite distribuida en lugar de golpear OpenF1 con sus rate limits.

**Arquitectura**: el cliente Turso (con su token) vive SOLO en las Vercel Functions de `api/cache/*`. El navegador llama a esas funciones; nunca ve el token directamente. Esto es necesario porque Turso (a diferencia de Supabase) no tiene row-level security.

---

## 1) Crear la base de datos en Turso

### Opción A — desde la CLI (recomendada)
```bash
# Instalar Turso CLI (una vez, en macOS / Linux / WSL)
curl -sSfL https://get.tur.so/install.sh | bash

# Autenticación
turso auth signup        # o `turso auth login` si ya tienes cuenta

# Crear la base de datos
turso db create f1-analytics

# Obtener la URL (libsql://...)
turso db show f1-analytics --url

# Generar un token (full access — solo se usa server-side en Vercel)
turso db tokens create f1-analytics
```

### Opción B — desde la web
1. https://turso.tech → Login → **Create Database**.
2. Nombre: `f1-analytics`. Región: la más cercana a la región de tu proyecto Vercel.
3. **Databases → f1-analytics → Connect**: copia la `URL` y genera un `Auth Token`.

Guarda **URL** y **Auth Token** — los necesitas en el paso 4.

---

## 2) Crear el esquema

Con la CLI:
```bash
turso db shell f1-analytics
```
Y dentro del shell pega:
```sql
CREATE TABLE IF NOT EXISTS cached_sessions (
  session_key   INTEGER PRIMARY KEY,
  year          INTEGER NOT NULL,
  round         INTEGER NOT NULL,
  session_type  TEXT NOT NULL,
  session_name  TEXT NOT NULL,
  circuit_id    TEXT NOT NULL,
  cached_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cached_laps (
  session_key   INTEGER NOT NULL,
  driver_number INTEGER NOT NULL,
  lap_number    INTEGER NOT NULL,
  lap_data      TEXT NOT NULL,
  PRIMARY KEY (session_key, driver_number, lap_number),
  FOREIGN KEY (session_key) REFERENCES cached_sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cached_telemetry (
  session_key   INTEGER NOT NULL,
  driver_number INTEGER NOT NULL,
  points        TEXT NOT NULL,
  PRIMARY KEY (session_key, driver_number)
);

CREATE TABLE IF NOT EXISTS cached_weather (
  session_key INTEGER PRIMARY KEY,
  summary     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_circuits (
  circuit_id TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  cached_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_laps_session_driver ON cached_laps (session_key, driver_number);
```
Sal del shell con `.quit`.

Desde la web puedes hacer lo mismo en *Databases → f1-analytics → Console*.

---

## 3) Variables de entorno

Las dos variables necesarias (NO usan prefijo `VITE_` porque solo las leen las funciones del servidor):

```
TURSO_DATABASE_URL=libsql://f1-analytics-<usuario>.turso.io
TURSO_AUTH_TOKEN=ey....
```

---

## 4) Configuración en Vercel (producción)

1. https://vercel.com → tu proyecto `f1-analytics` (importado desde GitHub) → **Settings → Environment Variables**.
2. Añade las dos variables:
   - Key `TURSO_DATABASE_URL` · Value: `libsql://…`
   - Key `TURSO_AUTH_TOKEN` · Value: `ey…`
   - Marca ambas para **Production**, **Preview** y **Development**.
3. Redeploy (Deployments → último → ⋯ → **Redeploy**). Sin redeploy las variables no aplican.

Vercel detecta automáticamente la carpeta `api/` y compila las funciones como serverless (Node runtime). No hace falta tocar `vercel.json`.

---

## 5) Desarrollo local

### Opción 1 — sin caché (más simple)
`npm run dev` arranca solo Vite. Las llamadas a `/api/cache/*` devolverán 404, el cliente lo detecta y degrada a "sin caché". La app funciona perfectamente, pero cada descarga golpea OpenF1.

### Opción 2 — con caché activa
Instala la CLI de Vercel:
```bash
npm i -g vercel
vercel link            # vincula el directorio al proyecto
vercel env pull        # baja las env vars del proyecto a .env.local
vercel dev             # arranca Vite + funciones de api/ en :3000
```
Ahora la app local sí persiste y lee desde Turso.

`.env.local` ya está en `.gitignore` — no se sube nunca.

---

## 6) Validación end-to-end

1. Despliega en Vercel y abre la URL.
2. **Conectar FastF1 API** → descarga una sesión cualquiera (p. ej. 2024 Bahrain Q). Primera vez golpea OpenF1.
3. Recarga la página y descarga la misma sesión otra vez. La barra debe completar prácticamente al instante con prefijo "(caché)" en cada paso.
4. En Turso (`turso db shell f1-analytics`):
   ```sql
   SELECT COUNT(*) FROM cached_laps;
   SELECT COUNT(*) FROM cached_telemetry;
   SELECT COUNT(*) FROM cached_sessions;
   ```
   Las filas deben ir creciendo conforme descargas más sesiones.

---

## 7) Troubleshooting

| Síntoma | Causa probable | Arreglo |
| --- | --- | --- |
| Llamadas a `/api/cache/*` devuelven 503 | Falta `TURSO_DATABASE_URL` o `TURSO_AUTH_TOKEN` en Vercel | Añadirlas y **redeploy** |
| 500 con `SQLITE_NO_SUCH_TABLE` | No corriste el esquema | Ejecuta el SQL del paso 2 en `turso db shell` |
| Funcionaba y de pronto siempre va a OpenF1 | El token caducó o se rotó | `turso db tokens create f1-analytics`, actualizar en Vercel, redeploy |
| Local muestra 404 en `/api/cache/*` | Estás en `npm run dev` (sin Vercel Functions) | Esperado — usa `vercel dev` si quieres caché local |

---

## 8) Sin Turso

Si las dos variables no están definidas, la primera llamada a una función devuelve 503, el cliente marca el caché como deshabilitado y a partir de ese momento todo va directo a OpenF1. La app sigue siendo plenamente funcional; sólo pierde la aceleración por persistencia.
