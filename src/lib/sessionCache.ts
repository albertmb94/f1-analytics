import type { Circuit, Lap, TelemetryPoint } from '../types/f1';
import type { SessionWeatherSummary } from './openf1';

// Thin client over the Vercel serverless functions in `/api/cache/*`.
// The Turso credentials live only on the server (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN);
// the browser never sees them. Each function degrades gracefully on failure so the
// app keeps working without cache (it just falls back to direct OpenF1 calls).

export interface CachedDriverDataset {
  telemetry: TelemetryPoint[];
  laps: Lap[];
}

// Cache the result of "is the cache backend reachable?" so we don't issue dozens
// of failed requests when running locally without Turso configured.
let cacheDisabled = false;

async function safeFetch<T>(url: string, init?: RequestInit): Promise<T | null> {
  if (cacheDisabled) return null;
  try {
    const res = await fetch(url, init);
    if (res.status === 503) {
      // Turso not configured (typical in `npm run dev` without env vars).
      cacheDisabled = true;
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadCachedDriverSession(
  sessionKey: number,
  driverNumber: number
): Promise<CachedDriverDataset | null> {
  const data = await safeFetch<CachedDriverDataset>(
    `/api/cache/driver-session?sessionKey=${sessionKey}&driverNumber=${driverNumber}`
  );
  if (!data) return null;
  if ((data.laps?.length ?? 0) === 0 && (data.telemetry?.length ?? 0) === 0) return null;
  return { telemetry: data.telemetry ?? [], laps: data.laps ?? [] };
}

export interface SaveDriverSessionMeta {
  year: number;
  round: number;
  sessionType: string;
  sessionName: string;
  circuitId: string;
}

export async function saveCachedDriverSession(
  sessionKey: number,
  driverNumber: number,
  telemetry: TelemetryPoint[],
  laps: Lap[],
  sessionMeta?: SaveDriverSessionMeta
): Promise<void> {
  await safeFetch<{ ok: boolean }>(
    '/api/cache/driver-session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey, driverNumber, telemetry, laps, sessionMeta })
    }
  );
}

export async function loadCachedWeather(sessionKey: number): Promise<SessionWeatherSummary | null> {
  const r = await safeFetch<{ summary: SessionWeatherSummary | null }>(
    `/api/cache/weather?sessionKey=${sessionKey}`
  );
  return r?.summary ?? null;
}

export async function saveCachedWeather(sessionKey: number, summary: SessionWeatherSummary): Promise<void> {
  await safeFetch<{ ok: boolean }>(
    '/api/cache/weather',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey, summary })
    }
  );
}

export async function loadCachedCircuit(circuitId: string): Promise<Circuit | null> {
  const r = await safeFetch<{ data: Circuit | null }>(
    `/api/cache/circuit?circuitId=${encodeURIComponent(circuitId)}`
  );
  return r?.data ?? null;
}

export async function saveCachedCircuit(circuit: Circuit): Promise<void> {
  await safeFetch<{ ok: boolean }>(
    '/api/cache/circuit',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circuitId: circuit.id, data: circuit })
    }
  );
}
