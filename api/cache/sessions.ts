import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../turso';

// GET /api/cache/sessions → [{ sessionKey, year, round, sessionType, sessionName, circuitId }]
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = getTursoClient();
  if (!client) {
    return res.status(503).json({ error: 'Turso not configured' });
  }

  try {
    const result = await client.execute(
      'SELECT session_key, year, round, session_type, session_name, circuit_id FROM cached_sessions ORDER BY year DESC, round DESC'
    );

    const sessions = result.rows.map(r => ({
      sessionKey: r.session_key as number,
      year: r.year as number,
      round: r.round as number,
      sessionType: r.session_type as string,
      sessionName: r.session_name as string,
      circuitId: r.circuit_id as string,
    }));

    return res.status(200).json({ sessions });
  } catch (err) {
    console.error('cache/sessions error', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
