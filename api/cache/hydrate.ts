import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso.js';

// GET /api/cache/hydrate
//   Returns every cached driver-session, lap, weather and session-meta in one
//   payload so a fresh device can rebuild `downloaded` without re-downloading
//   anything from OpenF1.
//   Shape:
//     {
//       sessions: [{ sessionKey, year, round, sessionType, sessionName, circuitId }],
//       telemetry: { [`${driverNumber}_${year}_${round}_${sessionType}`]: TelemetryPoint[] },
//       laps:      { [`${driverNumber}_${year}_${round}_${sessionType}`]: Lap[] },
//       weather:   { [`${year}_${round}_${sessionType}`]: SessionWeatherSummary }
//     }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = getTursoClient();
  if (!client) return res.status(503).json({ error: 'Turso not configured' });

  try {
    const [sessionsR, telR, lapsR, weatherR] = await Promise.all([
      client.execute('SELECT session_key, year, round, session_type, session_name, circuit_id FROM cached_sessions'),
      client.execute('SELECT session_key, driver_number, points FROM cached_telemetry'),
      client.execute('SELECT session_key, driver_number, lap_data FROM cached_laps ORDER BY lap_number ASC'),
      client.execute('SELECT session_key, summary FROM cached_weather'),
    ]);

    const sessionsByKey = new Map<number, { year: number; round: number; sessionType: string; sessionName: string; circuitId: string }>();
    const sessions = sessionsR.rows.map(r => {
      const meta = {
        sessionKey: r.session_key as number,
        year: r.year as number,
        round: r.round as number,
        sessionType: r.session_type as string,
        sessionName: r.session_name as string,
        circuitId: r.circuit_id as string,
      };
      sessionsByKey.set(meta.sessionKey, meta);
      return meta;
    });

    const telemetry: Record<string, unknown> = {};
    for (const row of telR.rows) {
      const meta = sessionsByKey.get(row.session_key as number);
      if (!meta) continue;
      const key = `${row.driver_number}_${meta.year}_${meta.round}_${meta.sessionType}`;
      telemetry[key] = JSON.parse(String(row.points));
    }

    const laps: Record<string, unknown[]> = {};
    for (const row of lapsR.rows) {
      const meta = sessionsByKey.get(row.session_key as number);
      if (!meta) continue;
      const key = `${row.driver_number}_${meta.year}_${meta.round}_${meta.sessionType}`;
      (laps[key] ||= []).push(JSON.parse(String(row.lap_data)));
    }

    const weather: Record<string, unknown> = {};
    for (const row of weatherR.rows) {
      const meta = sessionsByKey.get(row.session_key as number);
      if (!meta) continue;
      const key = `${meta.year}_${meta.round}_${meta.sessionType}`;
      weather[key] = JSON.parse(String(row.summary));
    }

    return res.status(200).json({ sessions, telemetry, laps, weather });
  } catch (err) {
    console.error('cache/hydrate error', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
