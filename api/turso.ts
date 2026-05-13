import { createClient, type Client } from '@libsql/client';

// Lazy singleton: created on the first request. If env vars are missing we expose
// `null` so handlers can short-circuit with a graceful 503 instead of crashing.
let client: Client | null | undefined = undefined;

export function getTursoClient(): Client | null {
  if (client !== undefined) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    client = null;
    return null;
  }
  client = createClient({ url, authToken });
  return client;
}

// CORRECCIÓN: Función async que retorna la promesa correctamente
export async function ensureCachedSessionMeta(c: Client, meta: {
  sessionKey: number;
  year: number;
  round: number;
  sessionType: string;
  sessionName: string;
  circuitId: string;
}) {
  return await c.execute({
    sql: `INSERT OR IGNORE INTO cached_sessions
      (session_key, year, round, session_type, session_name, circuit_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [meta.sessionKey, meta.year, meta.round, meta.sessionType, meta.sessionName, meta.circuitId]
  });
}
