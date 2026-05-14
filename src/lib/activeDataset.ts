import type { Driver, Lap } from '../types/f1';

// The key format used across the app is `${driverId}_${year}_${round}_${sessionType}`.
// `activeSessionKeys` contains the `${year}_${round}_${sessionType}` suffixes that the
// user has chosen to keep active. A key whose suffix is not in the set is filtered out.
export function isActiveDatasetKey(key: string, activeSessionKeys: Set<string>): boolean {
  if (activeSessionKeys.size === 0) return true; // empty = no filter
  const idx = key.indexOf('_');
  if (idx < 0) return false;
  return activeSessionKeys.has(key.slice(idx + 1));
}

export function filterDatasetByActiveSessions<T>(
  data: Record<string, T>,
  activeSessionKeys: Set<string>
): Record<string, T> {
  if (activeSessionKeys.size === 0) return data;
  const out: Record<string, T> = {};
  Object.keys(data).forEach(key => {
    if (isActiveDatasetKey(key, activeSessionKeys)) out[key] = data[key];
  });
  return out;
}

export function filterDriversByActiveSessions(
  drivers: Driver[],
  laps: Record<string, Lap[]>,
  activeSessionKeys: Set<string>
): Driver[] {
  if (activeSessionKeys.size === 0) return drivers;
  const activeIds = new Set<string>();
  Object.keys(laps).forEach(key => {
    if (isActiveDatasetKey(key, activeSessionKeys)) {
      const driverId = key.split('_')[0];
      activeIds.add(driverId);
    }
  });
  return drivers.filter(d => activeIds.has(d.id));
}

export function makeSessionKey(year: number, round: number, sessionType: string): string {
  return `${year}_${round}_${sessionType}`;
}
