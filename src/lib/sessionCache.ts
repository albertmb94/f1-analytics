import type { Circuit, Lap, TelemetryPoint } from '../types/f1';
import type { SessionWeatherSummary } from './openf1';
import { supabase } from './supabaseClient';

export interface CachedDriverDataset {
  telemetry: TelemetryPoint[];
  laps: Lap[];
}

export async function loadCachedDriverSession(
  sessionKey: number,
  driverNumber: number
): Promise<CachedDriverDataset | null> {
  if (!supabase) return null;
  try {
    const [tel, lap] = await Promise.all([
      supabase
        .from('cached_telemetry')
        .select('points')
        .eq('session_key', sessionKey)
        .eq('driver_number', driverNumber)
        .maybeSingle(),
      supabase
        .from('cached_laps')
        .select('lap_data, lap_number')
        .eq('session_key', sessionKey)
        .eq('driver_number', driverNumber)
        .order('lap_number', { ascending: true })
    ]);
    const telPoints = (tel.data?.points as TelemetryPoint[] | undefined) ?? null;
    const lapsRows = (lap.data as Array<{ lap_data: Lap; lap_number: number }> | null) ?? null;
    if (!telPoints && (!lapsRows || lapsRows.length === 0)) return null;
    return {
      telemetry: telPoints ?? [],
      laps: lapsRows ? lapsRows.map(r => r.lap_data) : []
    };
  } catch (err) {
    console.warn('Supabase loadCachedDriverSession failed', err);
    return null;
  }
}

export async function saveCachedDriverSession(
  sessionKey: number,
  driverNumber: number,
  telemetry: TelemetryPoint[],
  laps: Lap[]
): Promise<void> {
  if (!supabase) return;
  try {
    if (telemetry.length > 0) {
      await supabase
        .from('cached_telemetry')
        .upsert({ session_key: sessionKey, driver_number: driverNumber, points: telemetry });
    }
    if (laps.length > 0) {
      const rows = laps.map(l => ({
        session_key: sessionKey,
        driver_number: driverNumber,
        lap_number: l.number,
        lap_data: l
      }));
      await supabase.from('cached_laps').upsert(rows);
    }
  } catch (err) {
    console.warn('Supabase saveCachedDriverSession failed', err);
  }
}

export async function loadCachedWeather(sessionKey: number): Promise<SessionWeatherSummary | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from('cached_weather')
      .select('summary')
      .eq('session_key', sessionKey)
      .maybeSingle();
    return (data?.summary as SessionWeatherSummary | undefined) ?? null;
  } catch (err) {
    console.warn('Supabase loadCachedWeather failed', err);
    return null;
  }
}

export async function saveCachedWeather(sessionKey: number, summary: SessionWeatherSummary): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('cached_weather').upsert({ session_key: sessionKey, summary });
  } catch (err) {
    console.warn('Supabase saveCachedWeather failed', err);
  }
}

export async function loadCachedCircuit(circuitId: string): Promise<Circuit | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from('cached_circuits')
      .select('data')
      .eq('circuit_id', circuitId)
      .maybeSingle();
    return (data?.data as Circuit | undefined) ?? null;
  } catch (err) {
    console.warn('Supabase loadCachedCircuit failed', err);
    return null;
  }
}

export async function saveCachedCircuit(circuit: Circuit): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('cached_circuits').upsert({ circuit_id: circuit.id, data: circuit });
  } catch (err) {
    console.warn('Supabase saveCachedCircuit failed', err);
  }
}

export async function ensureCachedSessionMeta(params: {
  sessionKey: number;
  year: number;
  round: number;
  sessionType: string;
  sessionName: string;
  circuitId: string;
}): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('cached_sessions').upsert({
      session_key: params.sessionKey,
      year: params.year,
      round: params.round,
      session_type: params.sessionType,
      session_name: params.sessionName,
      circuit_id: params.circuitId
    });
  } catch (err) {
    console.warn('Supabase ensureCachedSessionMeta failed', err);
  }
}
