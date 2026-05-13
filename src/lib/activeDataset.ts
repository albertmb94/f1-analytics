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

export function filterWeatherByActiveSessions(
  weather: Record<string, unknown>,
  activeSessionKeys: Set<string>
): typeof weather {
  if (activeSessionKeys.size === 0) return weather;
  const out: typeof weather = {};
  Object.keys(weather).forEach(k => {
    if (activeSessionKeys.has(k)) out[k] = weather[k];
  });
  return out;
}

export function makeSessionKey(year: number, round: number, sessionType: string): string {
  return `${year}_${round}_${sessionType}`;
}
