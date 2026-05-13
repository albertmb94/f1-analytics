import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import type { Circuit, Driver, Team, TelemetryPoint, Lap } from '../types/f1';
import {
  loadYearMeetings,
  loadYearSessions,
  loadYearDriversFromSessions,
  mapDrivers,
  mapTeams,
  buildEvents,
  loadCircuitFromMeeting,
  normalizeCircuitId,
  downloadDriverSessionData,
  loadSessionWeather,
  type OpenF1Meeting,
  type SessionWeatherSummary
} from '../lib/openf1';
import {
  loadCachedDriverSession,
  saveCachedDriverSession,
  loadCachedWeather,
  saveCachedWeather
} from '../lib/sessionCache';

// ─────────────────────────────────────────────────────────────────────────────
// Types exposed to the app
// ─────────────────────────────────────────────────────────────────────────────

export interface FastF1Session {
  year: number;
  round: number;
  sessionName: string;
  sessionType: 'FP1' | 'FP2' | 'FP3' | 'Q' | 'R' | 'S' | 'SQ';
  date: string;
  circuit: string;
  sessionKey?: number;
  meetingKey?: number;
  isCancelled?: boolean;
  available?: boolean;
}

export interface FastF1Event {
  year: number;
  round: number;
  eventName: string;
  circuit: string;
  sessions: FastF1Session[];
  country: string;
  location: string;
  meetingKey?: number;
  officialName?: string;
  circuitInfoUrl?: string;
  isCancelled?: boolean;
}

export type { Circuit, Driver, Team, TelemetryPoint, Lap } from '../types/f1';

export interface F1Catalogue {
  years: number[];
  events: FastF1Event[];
  drivers: Record<number, Driver[]>;
  teams: Record<number, Team[]>;
  circuits: Circuit[];
}

export interface Selection {
  years: number[];
  events: FastF1Event[];
  sessions: FastF1Session[];
  drivers: Driver[];
  teams: Team[];
  circuits: Circuit[];
}

export interface FailedDriver {
  key: string;
  driver: Driver;
  session: FastF1Session;
  reason: string;
}

export interface FailedCircuit {
  circuitId: string;
  reason: string;
}

export type SessionWeather = SessionWeatherSummary;

export interface DownloadedData {
  telemetry: Record<string, TelemetryPoint[]>;
  laps: Record<string, Lap[]>;
  sessions: FastF1Session[];
  drivers: Driver[];
  teams: Team[];
  failedDrivers: FailedDriver[];
  weather: Record<string, SessionWeather>;
  lastUpdate: Date | null;
}

export type ApiStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface DataContextType {
  apiStatus: ApiStatus;
  apiError: string | null;
  connectingProgress: string;
  connectToFastF1: () => Promise<void>;
  catalogue: F1Catalogue | null;
  failedCircuits: FailedCircuit[];
  selection: Selection;
  toggleYear: (year: number) => void;
  toggleEvent: (ev: FastF1Event) => void;
  toggleSession: (s: FastF1Session) => void;
  toggleEventSingleSession: (ev: FastF1Event, s: FastF1Session) => void;
  toggleDriver: (d: Driver) => void;
  toggleTeam: (t: Team) => void;
  toggleCircuit: (c: Circuit) => void;
  selectAllForYear: (year: number) => void;
  clearSelection: () => void;
  canDownload: boolean;
  isDownloading: boolean;
  downloadProgress: { current: number; total: number; message: string };
  downloadData: () => Promise<void>;
  isRetrying: boolean;
  retryProgress: { current: number; total: number; message: string };
  retryFailedDrivers: () => Promise<void>;
  downloaded: DownloadedData;
  hasData: boolean;
  activeSessionKeys: Set<string>;
  setActiveSessionKeys: (next: Set<string>) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle');
  const [apiError, setApiError] = useState<string | null>(null);
  const [connectingProgress, setConnectingProgress] = useState('');
  const [catalogue, setCatalogue] = useState<F1Catalogue | null>(null);
  const [selection, setSelection] = useState<Selection>({
    years: [], events: [], sessions: [], drivers: [], teams: [], circuits: []
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, message: '' });
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryProgress, setRetryProgress] = useState({ current: 0, total: 0, message: '' });
  // Sessions the user has marked as "active" in the global header selector.
  // When non-empty, every consumer filters their dataset by this set.
  const [activeSessionKeys, setActiveSessionKeysState] = useState<Set<string>>(new Set());
  const setActiveSessionKeys = useCallback((next: Set<string>) => {
    setActiveSessionKeysState(new Set(next));
  }, []);
  const [downloaded, setDownloaded] = useState<DownloadedData>({
    telemetry: {}, laps: {}, sessions: [], drivers: [], teams: [], failedDrivers: [], weather: {}, lastUpdate: null
  });
  const [failedCircuits, setFailedCircuits] = useState<FailedCircuit[]>([]);

  // Connect and build real catalogue from OpenF1 — no silent fallback to mock data
  const connectToFastF1 = useCallback(async () => {
    setApiStatus('connecting');
    setApiError(null);
    try {
      const currentYear = new Date().getUTCFullYear();
      const firstYear = 2023;
      const years = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i);

      // 1) Load years sequentially to stay under OpenF1's rate limit.
      //    Meetings + sessions within a year are still parallel (2 requests).
      //    Each failing year is isolated so others still load.
      type YearPayload = {
        year: number;
        meetings: Awaited<ReturnType<typeof loadYearMeetings>>;
        sessions: Awaited<ReturnType<typeof loadYearSessions>>;
        rawDrivers: Awaited<ReturnType<typeof loadYearDriversFromSessions>>;
      };
      const yearErrors: string[] = [];
      const yearResults: Array<YearPayload | null> = [];

      for (let i = 0; i < years.length; i++) {
        const year = years[i];
        setConnectingProgress(`Cargando temporada ${year} (${i + 1}/${years.length})…`);
        try {
          const [meetings, sessions] = await Promise.all([
            loadYearMeetings(year),
            loadYearSessions(year),
          ]);
          const rawDrivers = await loadYearDriversFromSessions(sessions);
          yearResults.push({ year, meetings, sessions, rawDrivers });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`OpenF1: could not load ${year} — ${msg}`);
          yearErrors.push(`${year}: ${msg}`);
          yearResults.push(null);
        }
        // Pause between years to avoid triggering the API rate limit
        if (i < years.length - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      const yearPayload = yearResults.filter((p): p is NonNullable<typeof p> => p !== null);
      if (yearPayload.length === 0) {
        throw new Error(
          `No se pudo cargar ningún año. Errores:\n${yearErrors.join('\n')}`
        );
      }

      // 2) Build events with correct sessionKey, available flag, etc.
      const events = yearPayload.flatMap(({ meetings, sessions }) => buildEvents(meetings, sessions));

      // 3) Year-scoped driver / team rosters from real API data
      const driversByYear: Record<number, Driver[]> = {};
      const teamsByYear: Record<number, Team[]> = {};
      yearPayload.forEach(({ year, rawDrivers }) => {
        driversByYear[year] = mapDrivers(rawDrivers);
        teamsByYear[year] = mapTeams(rawDrivers);
      });

      // 4) Load circuit geometry from real circuit_info_url (one request per unique circuit)
      const uniqueMeetingByCircuit = new Map<string, OpenF1Meeting>();
      yearPayload.forEach(({ meetings }) => {
        meetings.forEach(meeting => {
          const cid = normalizeCircuitId(meeting.circuit_short_name);
          if (!uniqueMeetingByCircuit.has(cid)) uniqueMeetingByCircuit.set(cid, meeting);
        });
      });
      const circuitFailures: FailedCircuit[] = [];
      const circuitResults = await Promise.all(
        Array.from(uniqueMeetingByCircuit.values()).map(async m => {
          try {
            return await loadCircuitFromMeeting(m);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            const circuitId = normalizeCircuitId(m.circuit_short_name);
            circuitFailures.push({ circuitId, reason });
            console.warn(`OpenF1: circuit geometry failed for ${circuitId} — ${reason}`);
            return null;
          }
        })
      );
      const circuits = circuitResults.filter((c): c is Circuit => c !== null);
      setFailedCircuits(circuitFailures);

      setCatalogue({
        years: yearPayload.map(p => p.year),
        events,
        drivers: driversByYear,
        teams: teamsByYear,
        circuits
      });
      setSelection({ years: [], events: [], sessions: [], drivers: [], teams: [], circuits: [] });
      setConnectingProgress('');
      setApiStatus('connected');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('OpenF1 API connection failed:', msg);
      setApiError(msg);
      setApiStatus('error');
    }
  }, []);

  // Helpers based on selected years
  const availableDriversForSelection = useMemo(() => {
    if (!catalogue) return [];
    return selection.years
      .flatMap(year => catalogue.drivers[year] ?? [])
      .filter((d, i, arr) => arr.findIndex(x => x.id === d.id) === i);
  }, [catalogue, selection.years]);

  const availableTeamsForSelection = useMemo(() => {
    if (!catalogue) return [];
    return selection.years
      .flatMap(year => catalogue.teams[year] ?? [])
      .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i);
  }, [catalogue, selection.years]);

  const availableCircuitsForSelection = useMemo(() => {
    if (!catalogue) return [];
    const allowed = new Set(
      catalogue.events.filter(e => selection.years.includes(e.year)).map(e => e.circuit)
    );
    return catalogue.circuits.filter(c => allowed.has(c.id));
  }, [catalogue, selection.years]);

  // Selection toggles
  const toggleYear = useCallback((year: number) => {
    if (!catalogue) return;
    setSelection(prev => {
      const years = prev.years.includes(year)
        ? prev.years.filter(y => y !== year)
        : [...prev.years, year].sort();

      const drivers = years
        .flatMap(y => catalogue.drivers[y] ?? [])
        .filter((d, i, arr) => arr.findIndex(x => x.id === d.id) === i);
      const teams = years
        .flatMap(y => catalogue.teams[y] ?? [])
        .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i);
      const allowedCircuits = new Set(catalogue.events.filter(e => years.includes(e.year)).map(e => e.circuit));
      const circuits = catalogue.circuits.filter(c => allowedCircuits.has(c.id));

      return {
        years,
        events: prev.events.filter(e => years.includes(e.year)),
        sessions: prev.sessions.filter(s => years.includes(s.year)),
        drivers,
        teams,
        circuits
      };
    });
  }, [catalogue]);

  const toggleEvent = useCallback((ev: FastF1Event) => {
    setSelection(prev => {
      const exists = prev.events.some(x => x.year === ev.year && x.round === ev.round);
      if (exists) {
        return {
          ...prev,
          events: prev.events.filter(x => !(x.year === ev.year && x.round === ev.round)),
          sessions: prev.sessions.filter(x => !(x.year === ev.year && x.round === ev.round))
        };
      }
      const newSessions = ev.sessions.filter(s =>
        !prev.sessions.some(x => x.year === s.year && x.round === s.round && x.sessionType === s.sessionType)
      );
      return { ...prev, events: [...prev.events, ev], sessions: [...prev.sessions, ...newSessions] };
    });
  }, []);

  // Toggle a single session inside an event. If the event was not selected, marks just
  // this session (not all sessions of the event). If after toggling the event has no
  // selected sessions, the event itself is deselected.
  const toggleEventSingleSession = useCallback((ev: FastF1Event, session: FastF1Session) => {
    setSelection(prev => {
      const eventExists = prev.events.some(x => x.year === ev.year && x.round === ev.round);
      const sessionExists = prev.sessions.some(x => x.year === session.year && x.round === session.round && x.sessionType === session.sessionType);

      const events = eventExists ? prev.events : [...prev.events, ev];
      const sessions = sessionExists
        ? prev.sessions.filter(x => !(x.year === session.year && x.round === session.round && x.sessionType === session.sessionType))
        : [...prev.sessions, session];

      const stillHasSessions = sessions.some(s => s.year === ev.year && s.round === ev.round);
      const cleanEvents = stillHasSessions ? events : events.filter(e => !(e.year === ev.year && e.round === ev.round));

      return { ...prev, events: cleanEvents, sessions };
    });
  }, []);

  const toggleSession = useCallback((session: FastF1Session) => {
    setSelection(prev => {
      const exists = prev.sessions.some(x => x.year === session.year && x.round === session.round && x.sessionType === session.sessionType);
      return {
        ...prev,
        sessions: exists
          ? prev.sessions.filter(x => !(x.year === session.year && x.round === session.round && x.sessionType === session.sessionType))
          : [...prev.sessions, session]
      };
    });
  }, []);

  const toggleDriver = useCallback((driver: Driver) => {
    setSelection(prev => {
      const exists = prev.drivers.some(x => x.id === driver.id);
      return { ...prev, drivers: exists ? prev.drivers.filter(x => x.id !== driver.id) : [...prev.drivers, driver] };
    });
  }, []);

  const toggleTeam = useCallback((team: Team) => {
    setSelection(prev => {
      const exists = prev.teams.some(x => x.id === team.id);
      return { ...prev, teams: exists ? prev.teams.filter(x => x.id !== team.id) : [...prev.teams, team] };
    });
  }, []);

  const toggleCircuit = useCallback((circuit: Circuit) => {
    setSelection(prev => {
      const exists = prev.circuits.some(x => x.id === circuit.id);
      return { ...prev, circuits: exists ? prev.circuits.filter(x => x.id !== circuit.id) : [...prev.circuits, circuit] };
    });
  }, []);

  const selectAllForYear = useCallback((year: number) => {
    if (!catalogue) return;
    const yearEvents = catalogue.events.filter(e => e.year === year);
    const yearSessions = yearEvents.flatMap(e => e.sessions);
    const yearDrivers = catalogue.drivers[year] ?? [];
    const yearTeams = catalogue.teams[year] ?? [];
    const yearCircuits = catalogue.circuits.filter(c => yearEvents.some(e => e.circuit === c.id));
    setSelection(prev => ({
      years: prev.years.includes(year) ? prev.years : [...prev.years, year].sort(),
      events: [...prev.events, ...yearEvents.filter(e => !prev.events.some(x => x.year === e.year && x.round === e.round))],
      sessions: [...prev.sessions, ...yearSessions.filter(s => !prev.sessions.some(x => x.year === s.year && x.round === s.round && x.sessionType === s.sessionType))],
      drivers: [...prev.drivers, ...yearDrivers.filter(d => !prev.drivers.some(x => x.id === d.id))],
      teams: [...prev.teams, ...yearTeams.filter(t => !prev.teams.some(x => x.id === t.id))],
      circuits: [...prev.circuits, ...yearCircuits.filter(c => !prev.circuits.some(x => x.id === c.id))]
    }));
  }, [catalogue]);

  const clearSelection = useCallback(() => {
    setSelection({ years: [], events: [], sessions: [], drivers: [], teams: [], circuits: [] });
  }, []);

  // Resolve effective download scope from explicit selection + filters
  const resolvedScope = useMemo(() => {
    if (!catalogue) return { sessions: [] as FastF1Session[], drivers: [] as Driver[], teams: [] as Team[], circuits: [] as Circuit[] };

    // Sessions: explicit sessions > selected events > selected circuits in selected years > all sessions in years
    let sessions = selection.sessions;
    if (sessions.length === 0 && selection.events.length > 0) {
      sessions = selection.events.flatMap(e => e.sessions);
    }
    if (sessions.length === 0 && selection.circuits.length > 0) {
      const circuitIds = new Set(selection.circuits.map(c => c.id));
      sessions = catalogue.events
        .filter(e => selection.years.includes(e.year) && circuitIds.has(e.circuit))
        .flatMap(e => e.sessions);
    }
    if (sessions.length === 0) {
      sessions = catalogue.events.filter(e => selection.years.includes(e.year)).flatMap(e => e.sessions);
    }
    sessions = sessions.filter((s, i, arr) => arr.findIndex(x => x.year === s.year && x.round === s.round && x.sessionType === s.sessionType) === i);

    // Drivers: explicit drivers > teams in selected years > all drivers in selected years
    let drivers = selection.drivers;
    if (drivers.length === 0 && selection.teams.length > 0) {
      const teamNames = new Set(selection.teams.map(t => t.name));
      drivers = availableDriversForSelection.filter(d => teamNames.has(d.team));
    }
    if (drivers.length === 0) {
      drivers = availableDriversForSelection;
    }
    drivers = drivers.filter((d, i, arr) => arr.findIndex(x => x.id === d.id) === i);

    // Teams for downloaded metadata
    const teams = selection.teams.length > 0
      ? selection.teams
      : availableTeamsForSelection.filter(t => drivers.some(d => d.team === t.name));

    return { sessions, drivers, teams, circuits: selection.circuits.length > 0 ? selection.circuits : availableCircuitsForSelection };
  }, [catalogue, selection, availableDriversForSelection, availableTeamsForSelection, availableCircuitsForSelection]);

  const canDownload = resolvedScope.sessions.length > 0 && resolvedScope.drivers.length > 0 && !isDownloading;

  const downloadData = useCallback(async () => {
    if (!catalogue) return;
    const { sessions, drivers, teams } = resolvedScope;
    if (sessions.length === 0 || drivers.length === 0) return;

    setIsDownloading(true);
    const total = sessions.length * drivers.length;
    setDownloadProgress({ current: 0, total, message: 'Preparando descarga OpenF1...' });

    const telemetry: Record<string, TelemetryPoint[]> = {};
    const laps: Record<string, Lap[]> = {};
    const weather: Record<string, SessionWeather> = {};
    const failedByKey = new Map<string, FailedDriver>();

    type Job = { driver: Driver; session: FastF1Session; circuit: Circuit | undefined; key: string };
    const allJobs: Job[] = [];
    sessions.forEach(session => {
      const circuit = catalogue.circuits.find(c => c.id === session.circuit);
      drivers.forEach(driver => {
        allJobs.push({
          driver,
          session,
          circuit,
          key: `${driver.id}_${session.year}_${session.round}_${session.sessionType}`
        });
      });
    });

    const tryFetchOne = async (job: Job, attemptLabel: string): Promise<{ fromCache: boolean }> => {
      const { driver, session, circuit, key } = job;
      if (!session.sessionKey) {
        failedByKey.set(key, { key, driver, session, reason: 'No session_key in OpenF1 catalogue (session not yet available)' });
        return { fromCache: false };
      }
      if (!circuit) {
        failedByKey.set(key, { key, driver, session, reason: `Circuit geometry missing for ${session.circuit}` });
        return { fromCache: false };
      }
      // Try Supabase cache first (instant if present, OpenF1 quota saved)
      const cached = await loadCachedDriverSession(session.sessionKey, Number(driver.id));
      if (cached && (cached.laps.length > 0 || cached.telemetry.length > 0)) {
        telemetry[key] = cached.telemetry;
        laps[key] = cached.laps;
        failedByKey.delete(key);
        return { fromCache: true };
      }
      try {
        const dataset = await downloadDriverSessionData({
          sessionKey: session.sessionKey,
          driverNumber: Number(driver.id),
          driver,
          session,
          circuit
        });
        if (dataset.status === 'ok') {
          telemetry[key] = dataset.telemetry;
          laps[key] = dataset.laps;
          failedByKey.delete(key);
          // Fire-and-forget: persist to Turso (via /api/cache) for future visits
          saveCachedDriverSession(
            session.sessionKey,
            Number(driver.id),
            dataset.telemetry,
            dataset.laps,
            {
              year: session.year,
              round: session.round,
              sessionType: session.sessionType,
              sessionName: session.sessionName,
              circuitId: session.circuit
            }
          );
        } else {
          failedByKey.set(key, { key, driver, session, reason: dataset.reason });
          console.warn(`OpenF1[${attemptLabel}]: ${driver.name} ${session.year} R${session.round} ${session.sessionName} — ${dataset.reason}`);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failedByKey.set(key, { key, driver, session, reason });
        console.error(`OpenF1[${attemptLabel}]: ${driver.name} ${session.year} R${session.round} ${session.sessionName} — ${reason}`);
      }
      return { fromCache: false };
    };

    // First pass: weather + per-driver telemetry, with a small spacing between drivers
    // to give OpenF1's rate limiter room to recover.
    let processed = 0;
    for (let si = 0; si < sessions.length; si++) {
      const session = sessions[si];
      const sessionKeyStr = `${session.year}_${session.round}_${session.sessionType}`;
      if (session.sessionKey) {
        const cachedW = await loadCachedWeather(session.sessionKey);
        if (cachedW) {
          weather[sessionKeyStr] = cachedW;
        } else {
          const summary = await loadSessionWeather(session.sessionKey);
          if (summary) {
            weather[sessionKeyStr] = summary;
            saveCachedWeather(session.sessionKey, summary);
          }
        }
      }
      for (let di = 0; di < drivers.length; di++) {
        const job = allJobs.find(j => j.driver.id === drivers[di].id && j.session === session);
        if (!job) continue;
        processed += 1;
        setDownloadProgress({
          current: processed,
          total,
          message: `${job.driver.name} — ${session.year} R${session.round} ${session.sessionName}`
        });
        const result = await tryFetchOne(job, 'pass1');
        if (result.fromCache) {
          setDownloadProgress({
            current: processed,
            total,
            message: `(caché) ${job.driver.name} — ${session.year} R${session.round} ${session.sessionName}`
          });
          // Cache hits are instant; skip the rate-limit cooldown
          continue;
        }
        // 200ms gap between drivers smooths burst load on the rate limiter
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Retry pass: any failure that looks rate-limit-related gets one more attempt
    // after a long cooldown. The fetchJson exponential backoff already handles
    // single 429s; this catches the case where it ran out of in-call retries.
    const retryable = Array.from(failedByKey.values()).filter(f => /\b429\b|rate/i.test(f.reason));
    if (retryable.length > 0) {
      setDownloadProgress({
        current: processed,
        total,
        message: `Reintentando ${retryable.length} pilotos tras rate-limit (15s cooldown)…`
      });
      await new Promise(r => setTimeout(r, 15000));
      for (const f of retryable) {
        const job = allJobs.find(j => j.key === f.key);
        if (!job) continue;
        setDownloadProgress({
          current: processed,
          total,
          message: `Reintentando: ${job.driver.name} — ${job.session.year} R${job.session.round} ${job.session.sessionName}`
        });
        await tryFetchOne(job, 'retry');
        await new Promise(r => setTimeout(r, 600));
      }
    }

    const failedDrivers = Array.from(failedByKey.values());

    setDownloaded({
      telemetry,
      laps,
      sessions,
      drivers,
      teams,
      failedDrivers,
      weather,
      lastUpdate: new Date()
    });

    // Activate ALL downloaded sessions by default; the user can refine via the header selector.
    setActiveSessionKeysState(prev => {
      const next = new Set<string>(prev);
      sessions.forEach(s => next.add(`${s.year}_${s.round}_${s.sessionType}`));
      // Drop entries that are no longer in the downloaded set (e.g. previous descargas)
      const downloadedSet = new Set(sessions.map(s => `${s.year}_${s.round}_${s.sessionType}`));
      Array.from(next).forEach(k => { if (!downloadedSet.has(k)) next.delete(k); });
      // If after pruning it's empty (edge case), enable all
      if (next.size === 0) sessions.forEach(s => next.add(`${s.year}_${s.round}_${s.sessionType}`));
      return next;
    });

    setIsDownloading(false);
    setDownloadProgress({ current: 0, total: 0, message: '' });
  }, [catalogue, resolvedScope]);

  const retryFailedDrivers = useCallback(async () => {
    if (!catalogue) return;
    if (downloaded.failedDrivers.length === 0) return;
    if (isDownloading || isRetrying) return;

    setIsRetrying(true);

    // Snapshot the current failures and existing data so we can mutate locally
    const queue = [...downloaded.failedDrivers];
    const telemetry: Record<string, TelemetryPoint[]> = { ...downloaded.telemetry };
    const laps: Record<string, Lap[]> = { ...downloaded.laps };
    const recovered = new Map<string, FailedDriver>();
    const stillFailing = new Map<string, FailedDriver>();

    const fetchOne = async (item: FailedDriver, attemptLabel: string): Promise<{ ok: boolean; reason?: string }> => {
      const { driver, session } = item;
      if (!session.sessionKey) {
        return { ok: false, reason: 'No session_key in OpenF1 catalogue (session not yet available)' };
      }
      const circuit = catalogue.circuits.find(c => c.id === session.circuit);
      if (!circuit) {
        return { ok: false, reason: `Circuit geometry missing for ${session.circuit}` };
      }
      // Check Supabase cache first — another user may have already loaded this driver
      const cached = await loadCachedDriverSession(session.sessionKey, Number(driver.id));
      if (cached && (cached.laps.length > 0 || cached.telemetry.length > 0)) {
        telemetry[item.key] = cached.telemetry;
        laps[item.key] = cached.laps;
        return { ok: true };
      }
      try {
        const dataset = await downloadDriverSessionData({
          sessionKey: session.sessionKey,
          driverNumber: Number(driver.id),
          driver,
          session,
          circuit
        });
        if (dataset.status === 'ok') {
          telemetry[item.key] = dataset.telemetry;
          laps[item.key] = dataset.laps;
          saveCachedDriverSession(
            session.sessionKey,
            Number(driver.id),
            dataset.telemetry,
            dataset.laps,
            {
              year: session.year,
              round: session.round,
              sessionType: session.sessionType,
              sessionName: session.sessionName,
              circuitId: session.circuit
            }
          );
          return { ok: true };
        }
        console.warn(`OpenF1[${attemptLabel}]: ${driver.name} ${session.year} R${session.round} ${session.sessionName} — ${dataset.reason}`);
        return { ok: false, reason: dataset.reason };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`OpenF1[${attemptLabel}]: ${driver.name} ${session.year} R${session.round} ${session.sessionName} — ${reason}`);
        return { ok: false, reason };
      }
    };

    const initialCooldown = queue.length > 3 ? 30000 : 5000;
    setRetryProgress({ current: 0, total: queue.length, message: `Esperando ${Math.round(initialCooldown / 1000)}s antes del reintento…` });
    await new Promise(r => setTimeout(r, initialCooldown));

    // First retry pass
    let processed = 0;
    for (const item of queue) {
      processed += 1;
      setRetryProgress({
        current: processed,
        total: queue.length,
        message: `Reintentando: ${item.driver.name} — ${item.session.year} R${item.session.round} ${item.session.sessionName}`
      });
      const res = await fetchOne(item, 'manual-retry-1');
      if (res.ok) {
        recovered.set(item.key, item);
      } else {
        stillFailing.set(item.key, { ...item, reason: res.reason ?? item.reason });
      }
      await new Promise(r => setTimeout(r, 800));
    }

    // Second retry pass for remaining rate-limit errors with longer cooldown
    const rateLimited = Array.from(stillFailing.values()).filter(f => /\b429\b|rate/i.test(f.reason));
    if (rateLimited.length > 0) {
      setRetryProgress({
        current: queue.length,
        total: queue.length,
        message: `Cooldown 90s antes del segundo intento (${rateLimited.length} pendientes)…`
      });
      await new Promise(r => setTimeout(r, 90000));
      for (let i = 0; i < rateLimited.length; i++) {
        const item = rateLimited[i];
        setRetryProgress({
          current: i + 1,
          total: rateLimited.length,
          message: `Segundo intento: ${item.driver.name} — ${item.session.year} R${item.session.round} ${item.session.sessionName}`
        });
        const res = await fetchOne(item, 'manual-retry-2');
        if (res.ok) {
          recovered.set(item.key, item);
          stillFailing.delete(item.key);
        } else {
          stillFailing.set(item.key, { ...item, reason: res.reason ?? item.reason });
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setDownloaded(prev => ({
      ...prev,
      telemetry,
      laps,
      failedDrivers: Array.from(stillFailing.values()),
      lastUpdate: new Date()
    }));
    setIsRetrying(false);
    setRetryProgress({ current: 0, total: 0, message: '' });
  }, [catalogue, downloaded, isDownloading, isRetrying]);

  const hasData = downloaded.lastUpdate !== null;

  const value: DataContextType = {
    apiStatus,
    apiError,
    connectingProgress,
    connectToFastF1,
    catalogue,
    failedCircuits,
    selection,
    toggleYear,
    toggleEvent,
    toggleSession,
    toggleEventSingleSession,
    toggleDriver,
    toggleTeam,
    toggleCircuit,
    selectAllForYear,
    clearSelection,
    canDownload,
    isDownloading,
    downloadProgress,
    downloadData,
    isRetrying,
    retryProgress,
    retryFailedDrivers,
    downloaded,
    hasData,
    activeSessionKeys,
    setActiveSessionKeys
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
};
