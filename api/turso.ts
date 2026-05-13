import { createClient, type Client } from '@libsql/client';

let client: Client | null | undefined = undefined;

export function getTursoClient(): Client | null {
  if (client !== undefined) return client;
  
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error('TURSO_DATABASE_URL is not set');
    client = null;
    return null;
  }

  try {
    client = createClient({ url, authToken });
    return client;
  } catch (error) {
    console.error('Failed to create Turso client:', error);
    client = null;
    return null;
  }
}

export async function ensureCachedSessionMeta(c: Client, meta: {
  sessionKey: number;
  year: number;
  round: number;
  sessionType: string;
  sessionName: string;
  circuitId: string;
}) {
  try {
    return await c.execute({
      sql: `INSERT OR IGNORE INTO cached_sessions
        (session_key, year, round, session_type, session_name, circuit_id)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [meta.sessionKey, meta.year, meta.round, meta.sessionType, meta.sessionName, meta.circuitId]
    });
  } catch (error) {
    console.error('Error inserting session meta:', error);
    throw error;
  }
}
