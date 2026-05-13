import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../turso.ts';

// GET /api/cache/circuit?circuitId=...   → { data } | { data: null }
// POST /api/cache/circuit  { circuitId, data }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const client = getTursoClient();
  if (!client) return res.status(503).json({ error: 'Turso not configured' });

  try {
    if (req.method === 'GET') {
      const circuitId = String(req.query.circuitId ?? '');
      if (!circuitId) return res.status(400).json({ error: 'circuitId required' });
      const r = await client.execute({
        sql: 'SELECT data FROM cached_circuits WHERE circuit_id = ?',
        args: [circuitId]
      });
      const data = r.rows.length > 0 ? JSON.parse(String(r.rows[0].data)) : null;
      return res.status(200).json({ data });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { circuitId, data } = body ?? {};
      if (!circuitId || !data) return res.status(400).json({ error: 'circuitId and data required' });
      await client.execute({
        sql: `INSERT INTO cached_circuits (circuit_id, data) VALUES (?, ?)
              ON CONFLICT(circuit_id) DO UPDATE SET data = excluded.data, cached_at = datetime('now')`,
        args: [circuitId, JSON.stringify(data)]
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('cache/circuit error', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
