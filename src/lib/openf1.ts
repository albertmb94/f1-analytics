import type { Circuit, Driver, Lap, Team, TelemetryPoint } from '../types/f1';
import type { FastF1Event, FastF1Session } from '../context/DataContext';
import { CURATED_PROFILES } from './circuitCatalog';

const OPENF1_BASE = 'https://api.openf1.org/v1';

// ─────────────────────────────────────────────────────────────────────────────
// Raw API types
// ─────────────────────────────────────────────────────────────────────────────

export type OpenF1Meeting = {
  meeting_key: number;
  meeting_name: string;
  meeting_official_name: string;
  location: string;
  country_name: string;
  circuit_key: number;
  circuit_short_name: string;
  circuit_type: string;
  circuit_info_url?: string;
  circuit_image?: string;
  date_start: string;
  date_end: string;
  year: number;
  is_cancelled: boolean;
};

type OpenF1Session = {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
  circuit_short_name: string;
  country_name: string;
  location: string;
  year: number;
  is_cancelled: boolean;
};

type OpenF1Driver = {
  session_key: number;
  driver_number: number;
  full_name: string;
  first_name: string;
  last_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  headshot_url?: string;
};

// NOTE (2026 regs): OpenF1 has not exposed an aero-mode (X/Z) channel nor a
// Manual Override (MGU-K boost) deployment field as of writing. If a future
// schema adds them, surface them here as e.g. `mode: 'X' | 'Z' | null` and
// `override_active: 0 | 1`, then thread through to TelemetryPoint and the
// proxies in teamMetrics.ts. Until then the mode-fit penalty relies on
// computeAeroModeShare's throttle/RPM heuristic.
type OpenF1CarData = {
  date: string;
  driver_number: number;
  speed: number | null;
  rpm: number | null;
  n_gear: number | null;
  throttle: number | null;
  brake: number | null;
  drs: number | null;
};

type OpenF1Location = {
  date: string;
  driver_number: number;
  x: number | null;
  y: number | null;
  z: number | null;
};

type OpenF1Lap = {
  date_start: string;
  driver_number: number;
  lap_duration?: number;
  lap_number: number;
  is_pit_out_lap?: boolean;
  meeting_key: number;
  session_key: number;
  duration_sector_1?: number | null;
  duration_sector_2?: number | null;
  duration_sector_3?: number | null;
};

type OpenF1Stint = {
  compound: string;
  driver_number: number;
  lap_end: number;
  lap_start: number;
  session_key: number;
  stint_number: number;
  tyre_age_at_start: number;
};

type OpenF1Interval = {
  date: string;
  driver_number: number;
  gap_to_leader: number | string | null;
  interval: number | string | null;
  session_key: number;
};

type OpenF1Weather = {
  date: string;
  session_key: number;
  air_temperature: number | null;
  track_temperature: number | null;
  humidity: number | null;
  rainfall: number | null;
  wind_speed: number | null;
};

export interface SessionWeatherSummary {
  trackTemp: number;
  ambientTemp: number;
  humidity: number;
  rainfallProbability: number; // 0..1, share of samples with rainfall > 0
  windSpeed: number;
  sampleCount: number;
}

type MultiViewerCircuit = {
  corners?: Array<{ angle: number; length: number; number: number; trackPosition: { x: number; y: number } }>;
  marshalSectors?: Array<{ angle: number; length: number; number: number; trackPosition: { x: number; y: number } }>;
  x?: number[];
  y?: number[];
  circuitKey?: number;
  circuitName?: string;
  location?: string;
  countryName?: string;
  rotation?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

// Track when OpenF1 last rate-limited us so concurrent fetches can self-throttle
let openF1NextAllowedAt = 0;

const MAX_RETRIES_429 = 8;

async function fetchJson<T>(url: string, timeoutMs = 60000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let attempt = 0;
    while (true) {
      // Respect a previously-observed Retry-After window before issuing the next call
      const now = Date.now();
      if (openF1NextAllowedAt > now) {
        await new Promise(r => setTimeout(r, openF1NextAllowedAt - now));
      }

      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });

      if (res.status !== 429) {
        if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
        return res.json() as Promise<T>;
      }

      // Rate-limited: honor Retry-After, with exponential fallback
      attempt += 1;
      if (attempt > MAX_RETRIES_429) {
        throw new Error(`HTTP 429 (gave up after ${MAX_RETRIES_429} retries) — ${url}`);
      }
      const headerWait = Number(res.headers.get('Retry-After'));
      const expBackoff = Math.min(30, 2 ** attempt);
      const waitSeconds = Number.isFinite(headerWait) && headerWait > 0 ? headerWait : expBackoff;
      const waitMs = waitSeconds * 1000;
      // Update the global throttle gate so concurrent fetches also wait
      openF1NextAllowedAt = Math.max(openF1NextAllowedAt, Date.now() + waitMs);
      await new Promise(r => setTimeout(r, waitMs));
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timeout (${timeoutMs / 1000}s) — ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function mapSessionType(name: string): FastF1Session['sessionType'] {
  const normalized = name.toLowerCase();
  if (normalized.includes('practice 1')) return 'FP1';
  if (normalized.includes('practice 2')) return 'FP2';
  if (normalized.includes('practice 3')) return 'FP3';
  if (normalized.includes('sprint qualifying')) return 'SQ';
  if (normalized === 'sprint') return 'S';
  if (normalized.includes('qualifying')) return 'Q';
  if (normalized.includes('race')) return 'R';
  return 'FP1';
}

function makeDriverId(driverNumber: number) {
  return String(driverNumber);
}

function hexToCss(hex?: string) {
  if (!hex) return '#888888';
  return hex.startsWith('#') ? hex : `#${hex}`;
}

function buildTeamId(teamName: string) {
  return teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function compoundMap(compound?: string): 'Soft' | 'Medium' | 'Hard' {
  const c = (compound || '').toUpperCase();
  if (c.includes('SOFT')) return 'Soft';
  if (c.includes('MEDIUM')) return 'Medium';
  return 'Hard';
}

function drsIsActive(value: number) {
  return [10, 12, 14].includes(value);
}

function estimateDistance(idx: number, total: number, lapLength: number) {
  return (idx / Math.max(1, total - 1)) * lapLength;
}

function mapCornerClass(apexSpeed: number): 'Low' | 'Medium' | 'High' {
  if (apexSpeed < 120) return 'Low';
  if (apexSpeed < 190) return 'Medium';
  return 'High';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildCircuitProfile(
  corners: Circuit['corners'],
  circuitLength: number,
  circuitId: string
): { profile: Circuit['profile']; source: 'curated' | 'derived' } {
  // Curated profiles win when available — they reflect paddock consensus rather than
  // a heuristic derived from corner angles, which always over-classifies fast circuits.
  const curated = CURATED_PROFILES[circuitId];
  if (curated) {
    return {
      profile: { ...curated },
      source: 'curated'
    };
  }

  if (!corners.length) {
    return {
      profile: { downforceReq: 50, brakingEnergy: 50, tireWear: 50, topSpeedImportance: 50, lateralG: 50 },
      source: 'derived'
    };
  }

  const low = corners.filter(c => c.class === 'Low').length;
  const med = corners.filter(c => c.class === 'Medium').length;
  const high = corners.filter(c => c.class === 'High').length;
  const total = corners.length;
  const avgAngle = corners.reduce((sum, c) => sum + Math.abs(c.angle), 0) / total;

  // Distance-based geometry: gaps between consecutive corners ≈ straights
  const sortedDistances = corners.map(c => c.distance).sort((a, b) => a - b);
  let longestStraight = 0;
  for (let i = 1; i < sortedDistances.length; i++) {
    const gap = sortedDistances[i] - sortedDistances[i - 1];
    if (gap > longestStraight) longestStraight = gap;
  }
  // Account for the wrap-around start/finish straight
  if (sortedDistances.length > 0 && circuitLength > 0) {
    const wrap = circuitLength - sortedDistances[sortedDistances.length - 1] + sortedDistances[0];
    if (wrap > longestStraight) longestStraight = wrap;
  }
  const straightFraction = circuitLength > 0 ? longestStraight / circuitLength : 0;

  const topSpeedImportance = Math.round(clamp(30 + straightFraction * 250, 10, 95));
  const downforceReq = Math.round(clamp(110 - topSpeedImportance - (low / total) * 15, 5, 95));
  const brakingEnergy = Math.round(clamp((low / total) * 80 + (avgAngle / 180) * 25 + 15, 10, 95));
  const tireWear = Math.round(clamp((med / total) * 35 + (high / total) * 30 + (low / total) * 20 + 25, 10, 95));
  const lateralG = Math.round(clamp(((high * 0.6 + med * 1.0 + low * 0.3) / total) * 90 + 10, 10, 95));

  return {
    profile: { downforceReq, brakingEnergy, tireWear, topSpeedImportance, lateralG },
    source: 'derived'
  };
}

function inferWeather(countryName: string) {
  const lower = countryName.toLowerCase();
  if (lower.includes('bahrain') || lower.includes('saudi') || lower.includes('qatar') || lower.includes('abu')) {
    return { trackTemp: 36, ambientTemp: 28, humidity: 45, rainProbability: 0.02 };
  }
  if (lower.includes('singapore')) {
    return { trackTemp: 31, ambientTemp: 29, humidity: 78, rainProbability: 0.35 };
  }
  if (lower.includes('belgium') || lower.includes('netherlands') || lower.includes('united kingdom')) {
    return { trackTemp: 24, ambientTemp: 18, humidity: 68, rainProbability: 0.32 };
  }
  return { trackTemp: 30, ambientTemp: 24, humidity: 55, rainProbability: 0.15 };
}

function inferPirelli(circuitType?: string) {
  const type = (circuitType || '').toLowerCase();
  if (type.includes('street')) return { abrasion: 2, grip: 3, lateralStress: 3, longitudinalStress: 3 };
  return { abrasion: 3, grip: 4, lateralStress: 4, longitudinalStress: 4 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue loading
// ─────────────────────────────────────────────────────────────────────────────

export async function loadYearMeetings(year: number): Promise<OpenF1Meeting[]> {
  const raw = await fetchJson<unknown>(`${OPENF1_BASE}/meetings?year=${year}`);
  if (!Array.isArray(raw)) throw new Error(`/meetings?year=${year} returned non-array (${typeof raw})`);
  return (raw as OpenF1Meeting[]).filter(m => !m.meeting_name?.toLowerCase().includes('testing'));
}

export async function loadYearSessions(year: number): Promise<OpenF1Session[]> {
  const raw = await fetchJson<unknown>(`${OPENF1_BASE}/sessions?year=${year}`);
  if (!Array.isArray(raw)) throw new Error(`/sessions?year=${year} returned non-array (${typeof raw})`);
  return (raw as OpenF1Session[]).filter(s => !s.session_name?.toLowerCase().includes('day '));
}

export async function loadYearDrivers(year: number): Promise<OpenF1Driver[]> {
  const sessions = await loadYearSessions(year);
  return loadYearDriversFromSessions(sessions);
}

// Reuses an already-loaded session list — avoids an extra /sessions round-trip
export async function loadYearDriversFromSessions(sessions: OpenF1Session[]): Promise<OpenF1Driver[]> {
  const now = new Date();
  const valid = sessions.filter(s => !s.is_cancelled);
  // Prefer the most recent PAST session — its roster is guaranteed populated
  const past = valid
    .filter(s => new Date(s.date_start) <= now)
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  // For future-only seasons (e.g. early 2026), fall back to the closest upcoming session
  const future = valid
    .filter(s => new Date(s.date_start) > now)
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  const referenceSession = past[0] ?? future[0];
  if (!referenceSession) return [];
  try {
    return await fetchJson<OpenF1Driver[]>(`${OPENF1_BASE}/drivers?session_key=${referenceSession.session_key}`);
  } catch (err) {
    console.warn(`OpenF1: drivers roster missing for session ${referenceSession.session_key}`, err);
    return [];
  }
}

export function mapDrivers(drivers: OpenF1Driver[]): Driver[] {
  return drivers.map(d => ({
    id: makeDriverId(d.driver_number),
    name: d.full_name
      .toLowerCase()
      .split(' ')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    team: d.team_name,
    number: d.driver_number,
    color: hexToCss(d.team_colour)
  }));
}

export function mapTeams(drivers: OpenF1Driver[]): Team[] {
  const unique = new Map<string, Team>();
  drivers.forEach((d, idx) => {
    if (!unique.has(d.team_name)) {
      // derive synthetic performance coefficients only after real names are known
      unique.set(d.team_name, {
        id: buildTeamId(d.team_name),
        name: d.team_name,
        basePace: 92 + idx * 0.08,
        variance: 0.18 + (idx % 4) * 0.03,
        characteristics: {
          traction: 78 + (idx * 7) % 20,
          downforce: 76 + (idx * 5) % 22,
          drag: 68 + (idx * 3) % 18,
          tireManagement: 74 + (idx * 6) % 20
        }
      });
    }
  });
  return Array.from(unique.values());
}

export function buildEvents(meetings: OpenF1Meeting[], sessions: OpenF1Session[]): FastF1Event[] {
  const now = new Date();
  return meetings
    .filter(m => !m.is_cancelled || sessions.some(s => s.meeting_key === m.meeting_key && !s.is_cancelled))
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))
    .map((meeting, index) => {
      const meetingSessions = sessions
        .filter(s => s.meeting_key === meeting.meeting_key)
        .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))
        .map<FastF1Session>(s => ({
          year: s.year,
          round: index + 1,
          sessionName: s.session_name,
          sessionType: mapSessionType(s.session_name),
          date: s.date_start,
          circuit: normalizeCircuitId(meeting.circuit_short_name),
          sessionKey: s.session_key,
          meetingKey: s.meeting_key,
          isCancelled: s.is_cancelled,
          available: !s.is_cancelled && new Date(s.date_start) <= now
        }));
      return {
        year: meeting.year,
        round: index + 1,
        eventName: meeting.meeting_name,
        circuit: normalizeCircuitId(meeting.circuit_short_name),
        sessions: meetingSessions,
        country: meeting.country_name,
        location: meeting.location,
        meetingKey: meeting.meeting_key,
        officialName: meeting.meeting_official_name,
        circuitInfoUrl: meeting.circuit_info_url || '',
        isCancelled: meeting.is_cancelled
      } as FastF1Event;
    });
}

export function normalizeCircuitId(name: string) {
  if (!name) return 'unknown';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .replace('sakhir', 'bahrain')
    .replace('melbourne', 'albert_park')
    .replace('monte_carlo', 'monaco')
    .replace('montreal', 'villeneuve')
    .replace('spielberg', 'red_bull_ring')
    .replace('miami', 'miami')
    .replace('catalunya', 'catalunya');
}

export async function loadCircuitFromMeeting(meeting: OpenF1Meeting): Promise<Circuit> {
  let mv: MultiViewerCircuit | null = null;
  try {
    if (meeting.circuit_info_url) {
      mv = await fetchJson<MultiViewerCircuit>(meeting.circuit_info_url);
    }
  } catch {
    mv = null;
  }

  const corners = (mv?.corners ?? []).map((c) => {
    const distance = Number((c.length / 10).toFixed(1));
    const apexSpeed = Math.max(55, Math.min(300, Math.round(290 - Math.min(220, Math.abs(c.angle) * 0.9))));
    return {
      id: `t${c.number}`,
      name: String(c.number),
      distance,
      angle: c.angle,
      apexSpeed,
      class: mapCornerClass(apexSpeed),
      x: c.trackPosition.x,
      y: c.trackPosition.y
    };
  });

  const estimatedLength = corners.length > 0
    ? Math.max(...corners.map(c => c.distance)) + 200
    : 5000;

  const circuitId = normalizeCircuitId(meeting.circuit_short_name);
  const { profile, source } = buildCircuitProfile(corners, estimatedLength, circuitId);

  return {
    id: circuitId,
    name: mv?.circuitName || meeting.circuit_short_name,
    length: estimatedLength,
    corners,
    pirelliData: inferPirelli(meeting.circuit_type),
    weather: inferWeather(meeting.country_name),
    profile,
    profileSource: source
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather summary per session (one /weather call per session, regardless of drivers)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadSessionWeather(sessionKey: number): Promise<SessionWeatherSummary | null> {
  let raw: OpenF1Weather[];
  try {
    raw = await fetchJson<OpenF1Weather[]>(`${OPENF1_BASE}/weather?session_key=${sessionKey}`);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const trackTemps: number[] = [];
  const airTemps: number[] = [];
  const humidities: number[] = [];
  const winds: number[] = [];
  let rainSamples = 0;

  raw.forEach(r => {
    if (typeof r.track_temperature === 'number') trackTemps.push(r.track_temperature);
    if (typeof r.air_temperature === 'number') airTemps.push(r.air_temperature);
    if (typeof r.humidity === 'number') humidities.push(r.humidity);
    if (typeof r.wind_speed === 'number') winds.push(r.wind_speed);
    if (typeof r.rainfall === 'number' && r.rainfall > 0) rainSamples += 1;
  });

  const mean = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length);

  return {
    trackTemp: Math.round(mean(trackTemps) * 10) / 10,
    ambientTemp: Math.round(mean(airTemps) * 10) / 10,
    humidity: Math.round(mean(humidities)),
    rainfallProbability: raw.length > 0 ? rainSamples / raw.length : 0,
    windSpeed: Math.round(mean(winds) * 10) / 10,
    sampleCount: raw.length
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Download actual telemetry/laps
// ─────────────────────────────────────────────────────────────────────────────

export type DownloadResult =
  | { status: 'ok'; telemetry: TelemetryPoint[]; laps: Lap[] }
  | { status: 'empty'; reason: string }
  | { status: 'error'; reason: string };

export async function downloadDriverSessionData(params: {
  sessionKey: number;
  driverNumber: number;
  driver: Driver;
  session: FastF1Session;
  circuit: Circuit;
}): Promise<DownloadResult> {
  const { sessionKey, driverNumber, session, circuit } = params;

  // Phase 1: lightweight endpoints — laps/stints/intervals are small even for a full race.
  // Each fetch is isolated: a 4xx/5xx for one driver must not poison the whole Promise.all.
  let lapsError: string | null = null;
  const [lapsRaw, stintsRaw, intervalsRaw] = await Promise.all([
    fetchJson<OpenF1Lap[]>(`${OPENF1_BASE}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`)
      .catch((err: unknown) => {
        lapsError = err instanceof Error ? err.message : String(err);
        return [] as OpenF1Lap[];
      }),
    fetchJson<OpenF1Stint[]>(`${OPENF1_BASE}/stints?session_key=${sessionKey}&driver_number=${driverNumber}`).catch(() => [] as OpenF1Stint[]),
    fetchJson<OpenF1Interval[]>(`${OPENF1_BASE}/intervals?session_key=${sessionKey}&driver_number=${driverNumber}`).catch(() => [] as OpenF1Interval[]),
  ]);

  if (lapsError) {
    return { status: 'error', reason: `OpenF1 /laps failed: ${lapsError}` };
  }
  if (lapsRaw.length === 0) {
    return { status: 'empty', reason: 'OpenF1 returned no laps for this driver/session' };
  }

  // Phase 2: car_data + location only for the fastest lap window.
  // Fetching the full session would be ~20,000 rows at 3.7 Hz → browser timeout.
  // Limiting to one lap = ~250 rows → instant.
  let car: OpenF1CarData[] = [];
  let loc: OpenF1Location[] = [];

  // Must be a full flying lap: > 60 s excludes in-laps, formation laps, and VSC-split partials
  const validLaps = lapsRaw.filter(l =>
    typeof l.lap_duration === 'number' &&
    Number.isFinite(l.lap_duration) &&
    !l.is_pit_out_lap &&
    (l.lap_duration ?? 0) > 60
  );

  if (validLaps.length > 0) {
    const fastestLap = validLaps.reduce((a, b) =>
      (a.lap_duration ?? Infinity) < (b.lap_duration ?? Infinity) ? a : b
    );
    const lapStartMs = Date.parse(fastestLap.date_start);
    const lapEndMs = lapStartMs + ((fastestLap.lap_duration ?? 120) + 5) * 1000;
    const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
    // Use >= so samples at the exact timing-line crossing are included
    const dateFilter = `&date>=${toIso(lapStartMs)}&date<${toIso(lapEndMs)}`;

    [car, loc] = await Promise.all([
      fetchJson<OpenF1CarData[]>(
        `${OPENF1_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}${dateFilter}`
      ).catch(() => [] as OpenF1CarData[]),
      fetchJson<OpenF1Location[]>(
        `${OPENF1_BASE}/location?session_key=${sessionKey}&driver_number=${driverNumber}${dateFilter}`
      ).catch(() => [] as OpenF1Location[]),
    ]);
  }

  // Build telemetry: match car_data ↔ location by nearest timestamp,
  // then compute GPS-based cumulative distance for accurate spatial alignment.
  // This prevents the "shifted start" that occurs when two drivers have
  // different sample counts and both are naively mapped to [0, lapLength].
  const locSorted = loc.slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const locMs = locSorted.map(l => Date.parse(l.date));

  // Cumulative Euclidean distance along the GPS track
  const locCumDist: number[] = [0];
  for (let i = 1; i < locSorted.length; i++) {
    const dx = (locSorted[i].x ?? locSorted[i - 1].x ?? 0) - (locSorted[i - 1].x ?? 0);
    const dy = (locSorted[i].y ?? locSorted[i - 1].y ?? 0) - (locSorted[i - 1].y ?? 0);
    locCumDist.push(locCumDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const maxLocDist = locCumDist[locCumDist.length - 1] || 1;

  function nearestLocIdx(carTimestamp: number): number {
    if (locMs.length === 0) return -1;
    let lo = 0, hi = locMs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (locMs[mid] < carTimestamp) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(locMs[lo - 1] - carTimestamp) < Math.abs(locMs[lo] - carTimestamp)) lo--;
    return lo;
  }

  const t0 = car.length > 0 ? Date.parse(car[0].date) : 0;
  const telemetry: TelemetryPoint[] = car.map((carPoint, carIdx) => {
    const carTimestamp = Date.parse(carPoint.date);
    const lIdx = nearestLocIdx(carTimestamp);
    const locPoint = lIdx >= 0 ? locSorted[lIdx] : null;
    // GPS distance when location data available, else linear fallback
    const distance = locSorted.length > 1
      ? (locCumDist[lIdx >= 0 ? lIdx : 0] / maxLocDist) * circuit.length
      : estimateDistance(carIdx, car.length, circuit.length);

    return {
      time: (carTimestamp - t0) / 1000,
      distance,
      x: locPoint?.x ?? 0,
      y: locPoint?.y ?? 0,
      z: locPoint?.z ?? 0,
      speed: carPoint.speed ?? 0,
      rpm: carPoint.rpm ?? 0,
      gear: carPoint.n_gear ?? 0,
      throttle: (carPoint.throttle ?? 0) / 100,
      brake: (carPoint.brake ?? 0) / 100,
      drs: drsIsActive(carPoint.drs ?? 0)
    };
  });

  // Helper: map lap number to stint / compound / age
  function stintForLap(lapNumber: number) {
    return stintsRaw.find(s => lapNumber >= s.lap_start && lapNumber <= s.lap_end);
  }

  // Helper: aggregate interval samples by lap window
  function gapForLap(start: number, end: number) {
    const samples = intervalsRaw.filter(i => {
      const ts = Date.parse(i.date);
      return ts >= start && ts < end && typeof i.gap_to_leader === 'number';
    });
    if (!samples.length) return undefined;
    const avg = samples.reduce((sum, s) => sum + Number(s.gap_to_leader), 0) / samples.length;
    return Number(avg.toFixed(3));
  }

  // Map DRS activity by lap window
  function drsInLap(start: number, end: number) {
    return car.some(c => {
      const ts = Date.parse(c.date);
      return ts >= start && ts < end && drsIsActive(c.drs ?? 0);
    });
  }

  const laps: Lap[] = lapsRaw
    .filter(l => typeof l.lap_duration === 'number' && Number.isFinite(l.lap_duration))
    .map((lap, idx, arr) => {
      const lapStart = Date.parse(lap.date_start);
      const nextStart = idx < arr.length - 1 ? Date.parse(arr[idx + 1].date_start) : lapStart + Number(lap.lap_duration ?? 0) * 1000;
      const stint = stintForLap(lap.lap_number);
      const compound = compoundMap(stint?.compound);
      const tireAge = stint ? stint.tyre_age_at_start + (lap.lap_number - stint.lap_start) : lap.lap_number - 1;
      const gapToLeader = gapForLap(lapStart, nextStart);
      const drsActive = drsInLap(lapStart, nextStart);
      const fuelCorrection = session.sessionType === 'R' ? (arr.length - lap.lap_number) * 0.035 * 2.5 / 10 : 0;
      const s1 = typeof lap.duration_sector_1 === 'number' && Number.isFinite(lap.duration_sector_1) ? lap.duration_sector_1 : undefined;
      const s2 = typeof lap.duration_sector_2 === 'number' && Number.isFinite(lap.duration_sector_2) ? lap.duration_sector_2 : undefined;
      const s3 = typeof lap.duration_sector_3 === 'number' && Number.isFinite(lap.duration_sector_3) ? lap.duration_sector_3 : undefined;
      return {
        number: lap.lap_number,
        time: Number(lap.lap_duration ?? 0),
        fuelCorrectedTime: Number((Number(lap.lap_duration ?? 0) - fuelCorrection).toFixed(3)),
        isCleanAir: gapToLeader == null ? !drsActive : gapToLeader > 1.5 && !drsActive,
        tireCompound: compound,
        tireAge,
        drsActive,
        gapToLeader,
        sector1: s1,
        sector2: s2,
        sector3: s3
      };
    });

  return { status: 'ok', telemetry, laps };
}
