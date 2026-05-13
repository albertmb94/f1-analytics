import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureCachedSessionMeta, getTursoClient } from '../_lib/turso';

// GET /api/cache/driver-session?sessionKey=...&driverNumber=...
//   → { telemetry: TelemetryPoint[], laps: Lap[] } | { telemetry: [], laps: [] }
// POST /api/cache/driver-session
//   body: { sessionKey, driverNumber, telemetry, laps, sessionMeta }
//   → { ok: true }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const client = getTursoClient();
  if (!client) {
    return res.status(503).json({ error: 'Turso not configured' });
  }

  try {
    if (req.method === 'GET') {
      const sessionKey = Number(req.query.sessionKey);
      const driverNumber = Number(req.query.driverNumber);
      if (!Number.isFinite(sessionKey) || !Number.isFinite(driverNumber)) {
        return res.status(400).json({ error: 'sessionKey and driverNumber required' });
      }
      const [telRow, lapsRows] = await Promise.all([
        client.execute({
          sql: 'SELECT points FROM cached_telemetry WHERE session_key = ? AND driver_number = ?',
          args: [sessionKey, driverNumber]
        }),
        client.execute({
          sql: 'SELECT lap_data FROM cached_laps WHERE session_key = ? AND driver_number = ? ORDER BY lap_number ASC',
          args: [sessionKey, driverNumber]
        })
      ]);
      const telemetry = telRow.rows.length > 0 && telRow.rows[0].points
        ? JSON.parse(String(telRow.rows[0].points))
        : [];
      const laps = lapsRows.rows.map(r => JSON.parse(String(r.lap_data)));
      return res.status(200).json({ telemetry, laps });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { sessionKey, driverNumber, telemetry, laps, sessionMeta } = body ?? {};
      if (!Number.isFinite(sessionKey) || !Number.isFinite(driverNumber)) {
        return res.status(400).json({ error: 'sessionKey and driverNumber required' });
      }
      if (sessionMeta) {
        await ensureCachedSessionMeta(client, { ...sessionMeta, sessionKey });
      }
      if (Array.isArray(telemetry) && telemetry.length > 0) {
        await client.execute({
          sql: `INSERT INTO cached_telemetry (session_key, driver_number, points) VALUES (?, ?, ?)
                ON CONFLICT(session_key, driver_number) DO UPDATE SET points = excluded.points`,
          args: [sessionKey, driverNumber, JSON.stringify(telemetry)]
        });
      }
      if (Array.isArray(laps) && laps.length > 0) {
        // Batch upsert: SQLite has no multi-row UPSERT helper as terse as Postgres,
        // but libSQL accepts a batch of statements in one round-trip.
        const statements = laps.map(l => ({
          sql: `INSERT INTO cached_laps (session_key, driver_number, lap_number, lap_data) VALUES (?, ?, ?, ?)
                ON CONFLICT(session_key, driver_number, lap_number) DO UPDATE SET lap_data = excluded.lap_data`,
          args: [sessionKey, driverNumber, l.number, JSON.stringify(l)] as Array<number | string>
        }));
        await client.batch(statements, 'write');
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('cache/driver-session error', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
