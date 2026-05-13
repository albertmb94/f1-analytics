import type { Lap, TelemetryPoint } from '../types/f1';

export interface TeamMetrics {
  traction: number;
  downforce: number;
  drag: number;
  tireManagement: number;
}

export interface TeamPace {
  median: number;
  stdDev: number;
  sampleSize: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Slope of the best linear fit y = slope * x + intercept. Used for tire degradation.
export function linearSlope(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function isCleanLap(lap: Lap): boolean {
  return lap.isCleanAir && lap.time > 60 && lap.time < 200;
}

export function computeTopSpeed(telemetry: TelemetryPoint[]): number {
  let max = 0;
  for (const p of telemetry) if (p.speed > max) max = p.speed;
  return max;
}

// Average speed in apex windows: low average speed at apex implies the car is slowing more
// (less aero grip), so we invert: higher apex speed → higher downforce proxy.
// Returns null when the telemetry does not contain an apex window — we never want a 0
// to contaminate the team average (a 0 would mean "least downforce" instead of "no data").
export function computeDownforceProxy(telemetry: TelemetryPoint[]): number | null {
  if (telemetry.length === 0) return null;
  const apexSamples = telemetry.filter(p => p.brake > 0.1 || p.throttle < 0.5);
  if (apexSamples.length === 0) return null;
  const sum = apexSamples.reduce((s, p) => s + p.speed, 0);
  return sum / apexSamples.length;
}

// Traction: average rate of speed gain (km/h per second) under full throttle, below top speed.
export function computeTractionProxy(telemetry: TelemetryPoint[]): number | null {
  if (telemetry.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < telemetry.length; i++) {
    const prev = telemetry[i - 1];
    const cur = telemetry[i];
    const dt = cur.time - prev.time;
    if (dt <= 0 || dt > 1) continue;
    if (prev.throttle > 0.9 && cur.speed > prev.speed && cur.speed < 320) {
      deltas.push((cur.speed - prev.speed) / dt);
    }
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((s, v) => s + v, 0) / deltas.length;
}

// Drag proxy: top speed in long high-RPM stretches. Higher top speed ≈ less drag.
export function computeDragProxy(telemetry: TelemetryPoint[]): number | null {
  if (telemetry.length === 0) return null;
  const fullThrottle = telemetry.filter(p => p.throttle > 0.95 && p.rpm > 9000);
  if (fullThrottle.length === 0) return null;
  const top = fullThrottle.reduce((m, p) => Math.max(m, p.speed), 0);
  return top;
}

// Tire management: slope of fuel-corrected lap time vs tire age (per compound, then averaged).
// Lower (less degradation) is better — return -slope so higher score = better tire management.
export function computeTireManagement(laps: Lap[]): number {
  const clean = laps.filter(isCleanLap);
  if (clean.length < 3) return 0;
  const byCompound = new Map<string, Lap[]>();
  clean.forEach(l => {
    const arr = byCompound.get(l.tireCompound) ?? [];
    arr.push(l);
    byCompound.set(l.tireCompound, arr);
  });
  const slopes: number[] = [];
  byCompound.forEach(group => {
    if (group.length < 3) return;
    const xs = group.map(l => l.tireAge);
    const ys = group.map(l => l.fuelCorrectedTime);
    const n = xs.length;
    const meanX = xs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    if (den > 0) slopes.push(num / den);
  });
  if (slopes.length === 0) return 0;
  const avgSlope = slopes.reduce((s, v) => s + v, 0) / slopes.length;
  return -avgSlope;
}

export function computeDriverTeamPace(laps: Lap[]): TeamPace | null {
  const clean = laps.filter(isCleanLap).map(l => l.fuelCorrectedTime);
  if (clean.length === 0) return null;
  return { median: median(clean), stdDev: stdDev(clean), sampleSize: clean.length };
}

// Normalize within the bounded range [lo, hi] — never produces absolute 0% or 100%,
// which would suggest a team has "no skill at all" when the score is purely relative.
function normalize(map: Map<string, number>, lo = 25, hi = 95): Map<string, number> {
  const values = Array.from(map.values()).filter(v => Number.isFinite(v));
  if (values.length === 0) return new Map();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const out = new Map<string, number>();
  if (span < 1e-6) {
    map.forEach((_, k) => out.set(k, (lo + hi) / 2));
    return out;
  }
  map.forEach((v, k) => {
    if (!Number.isFinite(v)) {
      out.set(k, (lo + hi) / 2);
      return;
    }
    out.set(k, lo + ((v - min) / span) * (hi - lo));
  });
  return out;
}

export interface TeamRawSignals {
  topSpeed: number;
  downforceRaw: number;
  tractionRaw: number;
  dragRaw: number;
  tireRaw: number;
  driversWithData: number;
}

export interface TeamAggregateInput {
  team: string;
  drivers: Array<{
    driverId: string;
    telemetry: TelemetryPoint[];
    laps: Lap[];
  }>;
}

// Aggregate per-driver telemetry+laps into raw team signals.
// A team needs at least one driver with data; drivers without data are skipped.
export function aggregateRawSignals(input: TeamAggregateInput): TeamRawSignals | null {
  const driversWithTelemetry = input.drivers.filter(d => d.telemetry.length > 0 || d.laps.length > 0);
  if (driversWithTelemetry.length === 0) return null;

  const topSpeeds: number[] = [];
  const downs: number[] = [];
  const tractions: number[] = [];
  const drags: number[] = [];
  const tires: number[] = [];

  driversWithTelemetry.forEach(d => {
    if (d.telemetry.length > 0) {
      const ts = computeTopSpeed(d.telemetry);
      if (ts > 0) topSpeeds.push(ts);
      const dw = computeDownforceProxy(d.telemetry);
      if (dw != null) downs.push(dw);
      const tr = computeTractionProxy(d.telemetry);
      if (tr != null) tractions.push(tr);
      const dr = computeDragProxy(d.telemetry);
      if (dr != null) drags.push(dr);
    }
    if (d.laps.length > 0) {
      const tire = computeTireManagement(d.laps);
      if (tire !== 0) tires.push(tire);
    }
  });

  const avgOrNaN = (arr: number[]) => (arr.length === 0 ? Number.NaN : arr.reduce((s, v) => s + v, 0) / arr.length);

  return {
    topSpeed: avgOrNaN(topSpeeds),
    downforceRaw: avgOrNaN(downs),
    tractionRaw: avgOrNaN(tractions),
    dragRaw: avgOrNaN(drags),
    tireRaw: avgOrNaN(tires),
    driversWithData: driversWithTelemetry.length
  };
}

// Normalize raw signals across the set of teams to 0-100 scores.
// Returns a map of team name → TeamMetrics.
export function aggregateTeamMetrics(inputs: TeamAggregateInput[]): Map<string, TeamMetrics> {
  const raw = new Map<string, TeamRawSignals>();
  inputs.forEach(input => {
    const signal = aggregateRawSignals(input);
    if (signal) raw.set(input.team, signal);
  });

  const downMap = new Map<string, number>();
  const tracMap = new Map<string, number>();
  const dragMap = new Map<string, number>();
  const tireMap = new Map<string, number>();

  raw.forEach((s, team) => {
    downMap.set(team, s.downforceRaw);
    tracMap.set(team, s.tractionRaw);
    dragMap.set(team, s.dragRaw);
    tireMap.set(team, s.tireRaw);
  });

  const downNorm = normalize(downMap);
  const tracNorm = normalize(tracMap);
  // Drag is "less is better": invert raw top speed normalization
  const dragNormRaw = normalize(dragMap);
  const dragNorm = new Map<string, number>();
  dragNormRaw.forEach((v, k) => dragNorm.set(k, 100 - v));
  const tireNorm = normalize(tireMap);

  const out = new Map<string, TeamMetrics>();
  raw.forEach((_s, team) => {
    out.set(team, {
      traction: tracNorm.get(team) ?? 50,
      downforce: downNorm.get(team) ?? 50,
      drag: dragNorm.get(team) ?? 50,
      tireManagement: tireNorm.get(team) ?? 50
    });
  });
  return out;
}

export interface TeamPaceMap {
  pace: Map<string, TeamPace>;
  driverPace: Map<string, number>;
}

// Compute median pace per team and per driver from cleaned laps.
export function computePaceMaps(
  drivers: Array<{ driverId: string; team: string; laps: Lap[] }>
): TeamPaceMap {
  const teamLaps = new Map<string, number[]>();
  const driverPace = new Map<string, number>();

  drivers.forEach(d => {
    const clean = d.laps.filter(isCleanLap).map(l => l.fuelCorrectedTime);
    if (clean.length === 0) return;
    const driverMedian = median(clean);
    driverPace.set(d.driverId, driverMedian);
    const arr = teamLaps.get(d.team) ?? [];
    arr.push(...clean);
    teamLaps.set(d.team, arr);
  });

  const pace = new Map<string, TeamPace>();
  teamLaps.forEach((laps, team) => {
    if (laps.length === 0) return;
    pace.set(team, { median: median(laps), stdDev: stdDev(laps), sampleSize: laps.length });
  });

  return { pace, driverPace };
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ─── Ideal lap (sum of best micro-sectors) ──────────────────────────────────

function isValidSector(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 5 && v < 90;
}

function isValidRaceLap(lap: Lap): boolean {
  return lap.time > 60 && lap.time < 200;
}

export function computeBestLap(laps: Lap[]): number | null {
  const candidates = laps.filter(isValidRaceLap).map(l => l.time);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function computeIdealLap(laps: Lap[]): number | null {
  const eligible = laps.filter(isValidRaceLap);
  const s1: number[] = [];
  const s2: number[] = [];
  const s3: number[] = [];
  eligible.forEach(l => {
    if (isValidSector(l.sector1)) s1.push(l.sector1);
    if (isValidSector(l.sector2)) s2.push(l.sector2);
    if (isValidSector(l.sector3)) s3.push(l.sector3);
  });
  if (s1.length === 0 || s2.length === 0 || s3.length === 0) return null;
  return Math.min(...s1) + Math.min(...s2) + Math.min(...s3);
}

export interface DriverIdealEntry {
  driverId: string;
  team: string;
  bestLap: number | null;
  idealLap: number | null;
  cleanLapCount: number;
}

export interface TeamIdealEntry {
  team: string;
  bestDriverId: string;
  idealLap: number;
  bestLap: number | null;
  deltaToPole: number;
}

export function computeDriverIdeals(
  drivers: Array<{ driverId: string; team: string; laps: Lap[] }>
): DriverIdealEntry[] {
  return drivers.map(d => ({
    driverId: d.driverId,
    team: d.team,
    bestLap: computeBestLap(d.laps),
    idealLap: computeIdealLap(d.laps),
    cleanLapCount: d.laps.filter(isCleanLap).length
  }));
}

// For each driver in the input, returns the best representative time
// (ideal lap if available, otherwise best real lap). Used by the simulator
// to compute the per-driver adjustment relative to the team ideal.
export function computeDriverIdealMap(
  drivers: Array<{ driverId: string; team: string; laps: Lap[] }>
): Map<string, number> {
  const map = new Map<string, number>();
  drivers.forEach(d => {
    const ideal = computeIdealLap(d.laps);
    const best = computeBestLap(d.laps);
    const value = ideal ?? best;
    if (value != null) map.set(d.driverId, value);
  });
  return map;
}

// Variance estimator for the simulator that does NOT depend on isCleanAir.
// We take the team's combined laps, exclude in/out laps via a time gate,
// keep only the faster half (the ones a driver would actually attempt at the limit),
// and bound the resulting stdDev to a per-session-type range.
export type SessionTypeLite = 'FP1' | 'FP2' | 'FP3' | 'Q' | 'R' | 'S' | 'SQ';

export function computeIdealVariance(laps: Lap[], sessionType: SessionTypeLite): number {
  const eligible = laps
    .map(l => l.time)
    .filter(t => Number.isFinite(t) && t > 60 && t < 200);
  const isRace = sessionType === 'R' || sessionType === 'S';
  const floor = isRace ? 0.20 : 0.08;
  const ceiling = isRace ? 0.80 : 0.40;
  if (eligible.length < 3) return floor;
  const sorted = [...eligible].sort((a, b) => a - b);
  const fast = sorted.slice(0, Math.max(3, Math.ceil(sorted.length / 2)));
  const sigma = stdDev(fast);
  return Math.max(floor, Math.min(ceiling, sigma));
}

// Ranks teams by their best driver's ideal lap (or best real lap as fallback).
// A team is included only when at least one driver has a usable ideal/best lap.
export function computeTeamIdealRanking(
  drivers: Array<{ driverId: string; team: string; laps: Lap[] }>
): TeamIdealEntry[] {
  const ideals = computeDriverIdeals(drivers);
  const byTeam = new Map<string, DriverIdealEntry[]>();
  ideals.forEach(d => {
    const arr = byTeam.get(d.team) ?? [];
    arr.push(d);
    byTeam.set(d.team, arr);
  });

  const entries: TeamIdealEntry[] = [];
  byTeam.forEach((teamDrivers, team) => {
    let best: DriverIdealEntry | null = null;
    let bestRanking: number = Infinity;
    teamDrivers.forEach(d => {
      const ranking = d.idealLap ?? d.bestLap ?? Infinity;
      if (ranking < bestRanking) {
        bestRanking = ranking;
        best = d;
      }
    });
    if (!best || bestRanking === Infinity) return;
    const sel = best as DriverIdealEntry;
    entries.push({
      team,
      bestDriverId: sel.driverId,
      idealLap: sel.idealLap ?? sel.bestLap ?? bestRanking,
      bestLap: sel.bestLap,
      deltaToPole: 0
    });
  });

  entries.sort((a, b) => a.idealLap - b.idealLap);
  if (entries.length > 0) {
    const pole = entries[0].idealLap;
    entries.forEach(e => { e.deltaToPole = e.idealLap - pole; });
  }
  return entries;
}
