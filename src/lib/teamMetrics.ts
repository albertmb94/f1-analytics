import type { Lap, TelemetryPoint, Circuit } from '../types/f1';

export interface TeamMetrics {
  traction: number;
  downforce: number;
  drag: number;
  tireManagement: number;
  braking: number;
}

// 2026 F1 abolished DRS and introduced universal active aerodynamics with two
// modes (X = low drag for straights, Z = high downforce for corners). Anywhere
// the codebase branches on regulations, gate on this helper rather than
// hard-coding 2026 so future regulation changes only need one edit.
export function isModernRegulations(year: number): boolean {
  return year >= 2026;
}

export interface AeroModeShare {
  xMode: number; // fraction of telemetry samples in X-mode (low-drag, straight-line)
  zMode: number; // fraction of telemetry samples in Z-mode (high-downforce, corner)
  transitional: number;
  sampleCount: number;
}

// Heuristic mode classifier from telemetry. Real 2026 cars expose mode via a
// separate channel that OpenF1 does not yet ship, so we infer it from speed,
// RPM and throttle envelope. Tunable but kept conservative — calls between
// regimes should always sum to 1 across xMode + zMode + transitional.
export function computeAeroModeShare(telemetry: TelemetryPoint[]): AeroModeShare {
  if (telemetry.length === 0) return { xMode: 0, zMode: 0, transitional: 0, sampleCount: 0 };
  let x = 0;
  let z = 0;
  let transitional = 0;
  for (const p of telemetry) {
    const fullThrottle = p.throttle > 0.95;
    const highRpm = p.rpm > 9000;
    const highSpeed = p.speed > 250;
    const cornering = p.throttle < 0.7 && p.speed < 220 && p.brake < 0.3;
    if (fullThrottle && highRpm && highSpeed) x += 1;
    else if (cornering) z += 1;
    else transitional += 1;
  }
  const n = telemetry.length;
  return { xMode: x / n, zMode: z / n, transitional: transitional / n, sampleCount: n };
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

// Estimated lateral turn rate (rad/s) at sample i, using a centred difference
// of heading between samples (i-1, i) and (i, i+1). Returns 0 when geometry
// can't be derived (degenerate spacing, missing coordinates). Used to detect
// whether the car is still rotating while accelerating / braking, which lets
// the proxies distinguish a corner phase from a pure straight.
function turnRateRadPerSec(prev: TelemetryPoint, cur: TelemetryPoint, next: TelemetryPoint): number {
  const dx1 = cur.x - prev.x;
  const dy1 = cur.y - prev.y;
  const dx2 = next.x - cur.x;
  const dy2 = next.y - cur.y;
  const len1 = Math.hypot(dx1, dy1);
  const len2 = Math.hypot(dx2, dy2);
  if (len1 < 0.1 || len2 < 0.1) return 0;
  const cross = dx1 * dy2 - dy1 * dx2;
  const dot = dx1 * dx2 + dy1 * dy2;
  const angle = Math.atan2(cross, dot);
  const dt = next.time - prev.time;
  return dt > 0 ? Math.abs(angle) / dt : 0;
}

// Downforce proxy — average speed at mid-corner. Filters samples where the
// driver is rolling on neither pedal hard (throttle in [0.2, 0.8], brake low)
// and demands sustained occurrence (≥3 samples), so the entry-of-corner braking
// phase no longer leaks in and depresses cars with aggressive trail-braking.
// In 2026 this measures Z-mode effectiveness more than chassis aero alone, but
// the ranking interpretation is unchanged.
export function computeDownforceProxy(telemetry: TelemetryPoint[]): number | null {
  if (telemetry.length < 3) return null;
  const speeds: number[] = [];
  let streak = 0;
  let streakSum = 0;
  for (const p of telemetry) {
    const midCorner = p.throttle >= 0.2 && p.throttle <= 0.8 && p.brake < 0.1;
    if (midCorner) {
      streak += 1;
      streakSum += p.speed;
    } else {
      if (streak >= 3) speeds.push(streakSum / streak);
      streak = 0;
      streakSum = 0;
    }
  }
  if (streak >= 3) speeds.push(streakSum / streak);
  if (speeds.length === 0) return null;
  return speeds.reduce((s, v) => s + v, 0) / speeds.length;
}

// Traction proxy — average longitudinal acceleration (km/h per second) at
// corner exit. Demands full throttle AND the car still rotating (turn rate
// above ~0.05 rad/s) so a pure straight-line dragstrip-style burst (where
// power and drag dominate, not mechanical grip) is not counted. Falls back
// to "any full-throttle accel" when the telemetry lacks usable x/y geometry.
export function computeTractionProxy(telemetry: TelemetryPoint[]): number | null {
  if (telemetry.length < 3) return null;
  const TURN_THRESHOLD = 0.05;
  let hasGeometry = false;
  for (const p of telemetry) {
    if (p.x !== 0 || p.y !== 0) { hasGeometry = true; break; }
  }
  const deltas: number[] = [];
  for (let i = 1; i < telemetry.length - 1; i++) {
    const prev = telemetry[i - 1];
    const cur = telemetry[i];
    const next = telemetry[i + 1];
    const dt = cur.time - prev.time;
    if (dt <= 0 || dt > 1) continue;
    if (!(prev.throttle > 0.9 && cur.speed > prev.speed && cur.speed < 320)) continue;
    if (hasGeometry) {
      const omega = turnRateRadPerSec(prev, cur, next);
      if (omega < TURN_THRESHOLD) continue;
    }
    deltas.push((cur.speed - prev.speed) / dt);
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((s, v) => s + v, 0) / deltas.length;
}

// Drag proxy — 95th percentile of speed during sustained full-throttle stints
// (≥4 seconds, throttle>0.95). Switching from "absolute max" to P95 of long
// stints kills the single-outlier failure mode (slipstream gust or sensor
// spike) while keeping the metric responsive to the team's actual X-mode top
// speed. Higher value = less drag.
export function computeDragProxy(telemetry: TelemetryPoint[]): number | null {
  if (telemetry.length === 0) return null;
  const stints: number[][] = [];
  let cur: TelemetryPoint[] = [];
  for (const p of telemetry) {
    if (p.throttle > 0.95 && p.rpm > 9000) {
      cur.push(p);
    } else {
      if (cur.length > 0) {
        const dur = cur[cur.length - 1].time - cur[0].time;
        if (dur >= 4) stints.push(cur.map(x => x.speed));
        cur = [];
      }
    }
  }
  if (cur.length > 0) {
    const dur = cur[cur.length - 1].time - cur[0].time;
    if (dur >= 4) stints.push(cur.map(x => x.speed));
  }
  if (stints.length === 0) return null;
  const p95s = stints.map(speeds => quantile(speeds, 0.95));
  return p95s.reduce((s, v) => s + v, 0) / p95s.length;
}

// Braking proxy — peak deceleration in heavy braking events. For each
// continuous brake>0.9 segment, take the strongest Δspeed/Δtime decrease.
// Average across segments and return the magnitude. Used by the simulator
// to compute a *real* braking penalty instead of substituting traction.
export function computeBrakingProxy(telemetry: TelemetryPoint[]): number | null {
  if (telemetry.length < 2) return null;
  const peaks: number[] = [];
  let segmentPeak = 0;
  let inBrake = false;
  for (let i = 1; i < telemetry.length; i++) {
    const prev = telemetry[i - 1];
    const cur = telemetry[i];
    const dt = cur.time - prev.time;
    const heavy = prev.brake > 0.9 && cur.brake > 0.9;
    if (heavy && dt > 0 && dt < 1) {
      const decel = (prev.speed - cur.speed) / dt; // km/h per s, positive when slowing
      if (decel > segmentPeak) segmentPeak = decel;
      inBrake = true;
    } else if (inBrake) {
      if (segmentPeak > 0) peaks.push(segmentPeak);
      segmentPeak = 0;
      inBrake = false;
    }
  }
  if (inBrake && segmentPeak > 0) peaks.push(segmentPeak);
  if (peaks.length === 0) return null;
  return peaks.reduce((s, v) => s + v, 0) / peaks.length;
}

// Tire management — sample-weighted average of per-compound degradation slope.
// For each compound the team ran, regress fuel-corrected lap time on tire age,
// drop laps more than 2σ from the compound's median (in/out laps, traffic),
// then weight the slope by surviving sample size so 3 Soft laps no longer
// count the same as 12 Hard laps. Returns -slope so higher = better tire mgmt.
export function computeTireManagement(laps: Lap[]): number {
  const clean = laps.filter(isCleanLap);
  if (clean.length < 3) return 0;
  const byCompound = new Map<string, Lap[]>();
  clean.forEach(l => {
    const arr = byCompound.get(l.tireCompound) ?? [];
    arr.push(l);
    byCompound.set(l.tireCompound, arr);
  });

  let weightedSum = 0;
  let weightTotal = 0;
  byCompound.forEach(group => {
    if (group.length < 3) return;
    const times = group.map(l => l.fuelCorrectedTime);
    const med = median(times);
    const sigma = stdDev(times);
    const filtered = sigma > 0
      ? group.filter(l => Math.abs(l.fuelCorrectedTime - med) <= 2 * sigma)
      : group;
    if (filtered.length < 3) return;

    const xs = filtered.map(l => l.tireAge);
    const ys = filtered.map(l => l.fuelCorrectedTime);
    const n = xs.length;
    const meanX = xs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    if (den <= 0) return;
    const slope = num / den;
    weightedSum += slope * n;
    weightTotal += n;
  });

  if (weightTotal === 0) return 0;
  return -(weightedSum / weightTotal);
}

export function computeDriverTeamPace(laps: Lap[]): TeamPace | null {
  const clean = laps.filter(isCleanLap).map(l => l.fuelCorrectedTime);
  if (clean.length === 0) return null;
  return { median: median(clean), stdDev: stdDev(clean), sampleSize: clean.length };
}

// Percentile-rank normalization — each team gets a score equal to its rank
// quantile within the grid, scaled into [lo, hi]. Robust to outliers (one
// freakishly fast team no longer compresses the rest) and stable across
// sessions: "85" always means "top 15% of cars present" rather than "85% of
// the linear range between min and max", which changed each time a slow car
// dropped out of the pool. NaN inputs land at the mid-range and tie-break
// by averaging ranks.
function normalize(map: Map<string, number>, lo = 25, hi = 95): Map<string, number> {
  const entries = Array.from(map.entries());
  const out = new Map<string, number>();
  if (entries.length === 0) return out;

  const finiteEntries = entries.filter(([, v]) => Number.isFinite(v));
  if (finiteEntries.length === 0) {
    entries.forEach(([k]) => out.set(k, (lo + hi) / 2));
    return out;
  }
  if (finiteEntries.length === 1) {
    entries.forEach(([k, v]) => out.set(k, Number.isFinite(v) ? (lo + hi) / 2 : (lo + hi) / 2));
    return out;
  }

  // Sort by value ascending, then assign average rank for ties.
  const sorted = [...finiteEntries].sort(([, a], [, b]) => a - b);
  const rankByTeam = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][1] === sorted[i][1]) j += 1;
    const avgRank = (i + j) / 2; // 0-indexed average rank for the tie block
    for (let k = i; k <= j; k++) rankByTeam.set(sorted[k][0], avgRank);
    i = j + 1;
  }
  const denom = sorted.length - 1;

  entries.forEach(([k, v]) => {
    if (!Number.isFinite(v)) {
      out.set(k, (lo + hi) / 2);
      return;
    }
    const rank = rankByTeam.get(k) ?? 0;
    const q = denom > 0 ? rank / denom : 0.5;
    out.set(k, lo + q * (hi - lo));
  });
  return out;
}

export interface TeamRawSignals {
  topSpeed: number;
  downforceRaw: number;
  tractionRaw: number;
  dragRaw: number;
  tireRaw: number;
  brakingRaw: number;
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
  const brakes: number[] = [];

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
      const br = computeBrakingProxy(d.telemetry);
      if (br != null) brakes.push(br);
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
    brakingRaw: avgOrNaN(brakes),
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
  const brakeMap = new Map<string, number>();

  raw.forEach((s, team) => {
    downMap.set(team, s.downforceRaw);
    tracMap.set(team, s.tractionRaw);
    dragMap.set(team, s.dragRaw);
    tireMap.set(team, s.tireRaw);
    brakeMap.set(team, s.brakingRaw);
  });

  const downNorm = normalize(downMap);
  const tracNorm = normalize(tracMap);
  // Drag is "less is better": invert raw top-speed normalization so a high
  // top-speed team gets a high score on the "low drag" axis.
  const dragNormRaw = normalize(dragMap);
  const dragNorm = new Map<string, number>();
  dragNormRaw.forEach((v, k) => dragNorm.set(k, 100 - v));
  const tireNorm = normalize(tireMap);
  const brakeNorm = normalize(brakeMap);

  const out = new Map<string, TeamMetrics>();
  raw.forEach((_s, team) => {
    out.set(team, {
      traction: tracNorm.get(team) ?? 50,
      downforce: downNorm.get(team) ?? 50,
      drag: dragNorm.get(team) ?? 50,
      tireManagement: tireNorm.get(team) ?? 50,
      braking: brakeNorm.get(team) ?? 50
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

// Variance estimator (legacy) — kept as a fallback for teams with too few
// laps to bootstrap properly. The simulator's primary path now uses
// computeRaceableLapPool + sampleCenteredLap below, which preserves the
// actual shape of the team's lap-time distribution instead of squashing it
// into a bounded Gaussian.
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

// Returns the team's "qualifying-attempt" lap pool — values are signed
// deviations from the team's theoretical best, bootstrap-sampled by the
// simulator. Three filters keep the pool comparable across teams regardless
// of how much data sits in cache:
//
//   1. isCleanLap — drops in/out laps and laps in dirty air.
//   2. fuelCorrectedTime — strips the practice-fuel-weight signal so a
//      heavy FP1 lap and a light Q lap are on the same scale.
//   3. Top-30% trim — keeps only laps a driver actually attempted near
//      the limit. Without this trim, teams with long practice sessions
//      cached end up with a pool whose mean is 1–2 s above teamIdeal,
//      and the simulator's "expected pace" balloons by that mean
//      irrespective of qualifying potential — flipping the ranking
//      compared to the ideal-lap order.
//
// Returned values are clamped to ≥0: fuel correction is an estimate and can
// occasionally over-correct below the ideal, but a "faster than ideal" sample
// would push the team's mean below their own best microsectors, which is
// physically nonsensical for this estimator.
export function computeRaceableLapPool(laps: Lap[], teamIdeal: number): number[] {
  const eligible = laps
    .filter(isCleanLap)
    .map(l => l.fuelCorrectedTime)
    .filter(t => Number.isFinite(t) && t > 60 && t < 200);
  if (eligible.length === 0) return [];
  const sorted = [...eligible].sort((a, b) => a - b);
  const cut = Math.max(3, Math.floor(sorted.length * 0.3));
  return sorted.slice(0, cut).map(t => Math.max(0, t - teamIdeal));
}

// Standard Normal sampling via Box-Muller. Used for sub-lap noise floor when
// a team has too few laps to bootstrap reliably.
export function boxMullerGaussian(stddev: number): number {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Sample a single centered lap from the team pool. Falls back to Gaussian
// when the pool is empty (cold-start teams or thin sessions).
export function sampleCenteredLap(pool: number[], fallbackSigma: number): number {
  if (pool.length === 0) return boxMullerGaussian(fallbackSigma);
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

// Session-type-aware topology weights. Race weight on tirePenalty is much
// higher than Q because degradation drives a 50+ lap stint. Pole-style
// sessions reward outright lap potential, so topSpeedPenalty and downforce
// dominate.
export interface TopologyWeights {
  downforce: number;
  topSpeed: number;
  tire: number;
  braking: number;
}

export function topologyWeights(sessionType: SessionTypeLite): TopologyWeights {
  const isRace = sessionType === 'R' || sessionType === 'S';
  if (isRace) {
    // Race: tire wear and braking energy carry the long stint; downforce still
    // matters but less than in qualifying-style single-lap pushes.
    return { downforce: 0.25, topSpeed: 0.20, tire: 0.40, braking: 0.15 };
  }
  // Q / SQ / FP: outright single-lap pace.
  return { downforce: 0.40, topSpeed: 0.30, tire: 0.05, braking: 0.25 };
}

// Per-compound degradation slopes for a team. Same OLS-with-2σ-trim used by
// computeTireManagement, but returns the raw signed slope (seconds gained
// per lap of tire age) per compound the team actually ran, so the race-pace
// forecaster can apply the right degradation for each stint.
export type TireCompound = 'Soft' | 'Medium' | 'Hard';

export function computeCompoundDegradation(laps: Lap[]): Map<TireCompound, number> {
  const out = new Map<TireCompound, number>();
  const clean = laps.filter(isCleanLap);
  const byCompound = new Map<TireCompound, Lap[]>();
  clean.forEach(l => {
    const arr = byCompound.get(l.tireCompound) ?? [];
    arr.push(l);
    byCompound.set(l.tireCompound, arr);
  });
  byCompound.forEach((group, compound) => {
    if (group.length < 3) return;
    const times = group.map(l => l.fuelCorrectedTime);
    const med = median(times);
    const sigma = stdDev(times);
    const filtered = sigma > 0
      ? group.filter(l => Math.abs(l.fuelCorrectedTime - med) <= 2 * sigma)
      : group;
    if (filtered.length < 3) return;
    const xs = filtered.map(l => l.tireAge);
    const ys = filtered.map(l => l.fuelCorrectedTime);
    out.set(compound, linearSlope(xs, ys));
  });
  return out;
}

export interface RaceStrategyInput {
  team: string;
  baseLapTime: number;             // team's reference clean lap time (seconds)
  degradationByCompound: Map<TireCompound, number>; // seconds per lap of age
  raceLaps: number;
  pitLossSeconds: number;
  compoundOffset?: Partial<Record<TireCompound, number>>; // pace delta vs Medium baseline
}

export interface RaceStrategyResult {
  team: string;
  strategy: string;            // human-readable, e.g. "1-Stop M-H"
  stops: number;
  stints: Array<{ compound: TireCompound; laps: number }>;
  totalTime: number;           // seconds, sum of lap times + pit losses
  gapToBest: number;           // seconds vs the fastest strategy across this team
}

// Default compound pace deltas (s/lap vs Medium reference). Reasonable
// average across modern compounds; teams could deviate but we don't have a
// per-team measurement, so these are constants.
const DEFAULT_COMPOUND_OFFSET: Record<TireCompound, number> = {
  Soft: -0.4,
  Medium: 0,
  Hard: 0.5
};

// Total race time for a given stint plan, integrating the team's compound
// degradation linearly across each stint and adding pit losses between
// stints. Caller can build different stint plans (1-stop, 2-stop, …) and
// compare.
function totalRaceTime(plan: Array<{ compound: TireCompound; laps: number }>,
                       baseLap: number,
                       deg: Map<TireCompound, number>,
                       pitLoss: number,
                       offsets: Record<TireCompound, number>): number {
  let total = 0;
  plan.forEach((stint, idx) => {
    const offset = offsets[stint.compound] ?? 0;
    const slope = deg.get(stint.compound) ?? 0.05; // mild deg fallback
    for (let lap = 0; lap < stint.laps; lap++) {
      // Lap time = base + compound offset + degradation × tire age (in this stint).
      total += baseLap + offset + slope * lap;
    }
    if (idx < plan.length - 1) total += pitLoss;
  });
  return total;
}

// First-cut race strategy comparator. Builds a handful of canonical 1-stop
// and 2-stop plans (compound choice + even-ish stint splits), evaluates each
// against the team's degradation profile, and returns them ordered by total
// time. Intentionally coarse: no Safety Car / VSC, no track-position effects,
// no per-team compound offsets.
export function simulateRaceStrategies(input: RaceStrategyInput): RaceStrategyResult[] {
  const { team, baseLapTime, degradationByCompound, raceLaps, pitLossSeconds } = input;
  const offsets = { ...DEFAULT_COMPOUND_OFFSET, ...(input.compoundOffset ?? {}) };

  const split = (parts: number): number[] => {
    const base = Math.floor(raceLaps / parts);
    const rem = raceLaps - base * parts;
    return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
  };

  const oneStopSplit = split(2);
  const twoStopSplit = split(3);

  const candidates: Array<{ label: string; plan: Array<{ compound: TireCompound; laps: number }> }> = [
    { label: '1-Stop M→H', plan: [
      { compound: 'Medium', laps: oneStopSplit[0] },
      { compound: 'Hard', laps: oneStopSplit[1] }
    ]},
    { label: '1-Stop S→M', plan: [
      { compound: 'Soft', laps: oneStopSplit[0] },
      { compound: 'Medium', laps: oneStopSplit[1] }
    ]},
    { label: '2-Stop M→S→M', plan: [
      { compound: 'Medium', laps: twoStopSplit[0] },
      { compound: 'Soft', laps: twoStopSplit[1] },
      { compound: 'Medium', laps: twoStopSplit[2] }
    ]},
    { label: '2-Stop S→M→S', plan: [
      { compound: 'Soft', laps: twoStopSplit[0] },
      { compound: 'Medium', laps: twoStopSplit[1] },
      { compound: 'Soft', laps: twoStopSplit[2] }
    ]}
  ];

  const evaluated = candidates.map(c => ({
    team,
    strategy: c.label,
    stops: c.plan.length - 1,
    stints: c.plan,
    totalTime: totalRaceTime(c.plan, baseLapTime, degradationByCompound, pitLossSeconds, offsets),
    gapToBest: 0
  }));

  evaluated.sort((a, b) => a.totalTime - b.totalTime);
  if (evaluated.length > 0) {
    const best = evaluated[0].totalTime;
    evaluated.forEach(e => { e.gapToBest = e.totalTime - best; });
  }
  return evaluated;
}

// 2026 mode-fit penalty — compares the team's measured X-mode vs Z-mode
// usage share to what the circuit profile implies the optimal split should
// be. A team that runs X-mode rarely on Monza (high topSpeedImportance)
// gets penalised; a team that under-uses Z-mode on Hungaroring (high
// downforceReq) gets penalised too. Returns a non-negative penalty in the
// same lap-time-seconds unit as the rest of the topology calculation.
export interface CircuitAeroProfile {
  downforceReq: number;
  topSpeedImportance: number;
}

export function computeModeFitPenalty(
  teamShare: AeroModeShare,
  profile: CircuitAeroProfile
): number {
  if (teamShare.sampleCount === 0) return 0;
  const totalImportance = profile.downforceReq + profile.topSpeedImportance;
  if (totalImportance <= 0) return 0;
  const expectedX = profile.topSpeedImportance / totalImportance;
  const expectedZ = profile.downforceReq / totalImportance;
  // Renormalise the team's mode share to ignore transitional time so the
  // comparison is apples-to-apples.
  const used = teamShare.xMode + teamShare.zMode;
  if (used < 1e-6) return 0;
  const actualX = teamShare.xMode / used;
  const actualZ = teamShare.zMode / used;
  // L1 distance, scaled so a fully-misaligned setup costs ~0.4s (sub-Q-variance
  // scale, intentionally smaller than the chassis topology penalty).
  return (Math.abs(actualX - expectedX) + Math.abs(actualZ - expectedZ)) * 0.2;
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

// ─── Circuit base time and topology mismatch (reusable across components) ─────

export function calculateTopologyMismatch(
  chars: TeamMetrics,
  circuit: Circuit,
  sessionType: SessionTypeLite
): number {
  const w = topologyWeights(sessionType);
  const downforcePenalty = Math.abs(chars.downforce - circuit.profile.downforceReq) / 100;
  const topSpeedPenalty = Math.abs((100 - chars.drag) - circuit.profile.topSpeedImportance) / 100;
  const tirePenalty = Math.max(0, circuit.profile.tireWear - chars.tireManagement) / 100;
  const brakingPenalty = Math.max(0, circuit.profile.brakingEnergy - chars.braking) / 100;
  return (
    downforcePenalty * w.downforce
    + topSpeedPenalty * w.topSpeed
    + tirePenalty * w.tire
    + brakingPenalty * w.braking
  ) * 1.8;
}

// Estimate the reference lap time for a circuit (seconds) based on its physical
// characteristics and length. Used to project performance from one circuit to
// another: instead of using teamIdeal (tied to the source circuit) as the
// absolute baseline, we start from the target circuit's estimated base time
// and add team-specific residuals and topology mismatch adjustments.
export function estimateCircuitBaseTime(
  profile: { downforceReq: number; topSpeedImportance: number; brakingEnergy: number; lateralG: number },
  length: number
): number {
  const ratio = (profile.topSpeedImportance + 10) / (profile.downforceReq + profile.topSpeedImportance + 20);
  const avgSpeed = 150 + ratio * 130;
  return (length / avgSpeed) * 3.6;
}
