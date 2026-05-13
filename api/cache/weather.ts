import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso';

// GET /api/cache/weather?sessionKey=...   → { summary } | { summary: null }
// POST /api/cache/weather  { sessionKey, summary }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const client = getTursoClient();
  if (!client) return res.status(503).json({ error: 'Turso not configured' });

  try {
    if (req.method === 'GET') {
      const sessionKey = Number(req.query.sessionKey);
      if (!Number.isFinite(sessionKey)) return res.status(400).json({ error: 'sessionKey required' });
      const r = await client.execute({
        sql: 'SELECT summary FROM cached_weather WHERE session_key = ?',
        args: [sessionKey]
      });
      const summary = r.rows.length > 0 ? JSON.parse(String(r.rows[0].summary)) : null;
      return res.status(200).json({ summary });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { sessionKey, summary } = body ?? {};
      if (!Number.isFinite(sessionKey) || !summary) return res.status(400).json({ error: 'sessionKey and summary required' });
      await client.execute({
        sql: `INSERT INTO cached_weather (session_key, summary) VALUES (?, ?)
              ON CONFLICT(session_key) DO UPDATE SET summary = excluded.summary`,
        args: [sessionKey, JSON.stringify(summary)]
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('cache/weather error', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
