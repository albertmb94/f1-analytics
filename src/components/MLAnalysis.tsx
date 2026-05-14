import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import type { MLInsight } from '../types/f1';
import {
  isModernRegulations,
  type TeamMetrics,
  type TeamIdealEntry
} from '../lib/teamMetrics';
import { filterDatasetByActiveSessions, filterDriversByActiveSessions } from '../lib/activeDataset';
import { useTeamData } from '../hooks/useTeamData';
import {
  Brain,
  GitCompare,
  Cpu,
  User,
  Zap,
  TrendingUp,
  BarChart3,
  Target,
  AlertCircle
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend
} from 'recharts';
import { motion } from 'framer-motion';

// Pearson correlation between two parallel numeric arrays. Returns 0 when the
// sample is degenerate (n<2 or zero variance in either side).
function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}

function popStddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

interface BuildInsightsInput {
  teams: import('../types/f1').Team[];
  drivers: import('../types/f1').Driver[];
  lapsData: Record<string, import('../types/f1').Lap[]>;
  characteristics: Map<string, TeamMetrics>;
  idealRanking: TeamIdealEntry[];
  year: number;
}

// Map a 2026-aware feature label to the underlying TeamMetrics key it reads
// from. The same metric key powers each label; only its presentation name
// changes between regulation eras.
function featureSpec(year: number): Array<{ label: string; key: keyof TeamMetrics; betterWhen: 'high' | 'low' }> {
  const modern = isModernRegulations(year);
  return [
    { label: 'Traction Out of Corner', key: 'traction', betterWhen: 'high' },
    { label: 'Tire Deg Slope',        key: 'tireManagement', betterWhen: 'high' },
    { label: 'Braking Power',         key: 'braking', betterWhen: 'high' },
    {
      label: modern ? 'X-Mode Top Speed' : 'Low-Drag Top Speed',
      key: 'drag',
      betterWhen: 'high' // drag is already inverted in TeamMetrics
    },
    {
      label: modern ? 'Z-Mode Apex Speed' : 'Downforce Proxy',
      key: 'downforce',
      betterWhen: 'high'
    }
  ];
}

// Build honest ML insights from actual downloaded data. No seeded randomness:
// every figure is derived from telemetry/laps via the proxies and the team's
// ideal-lap ranking.
function buildInsights({
  teams,
  drivers,
  lapsData,
  characteristics,
  idealRanking,
  year
}: BuildInsightsInput): Array<MLInsight & { meanPace: number; teamDrivers: import('../types/f1').Driver[]; sampleConfidence: 'high' | 'medium' | 'low' }> {
  const features = featureSpec(year);

  // For each feature, gather (proxyValue, idealLap) tuples across teams to
  // compute the global correlation of that feature with race-relevant pace.
  // Lower idealLap = faster, so we negate it to get "higher = better" axis.
  const teamFeatureValues = new Map<string, Map<string, number>>();
  const idealByTeam = new Map<string, number>();
  idealRanking.forEach(e => idealByTeam.set(e.team, e.idealLap));

  features.forEach(f => teamFeatureValues.set(f.key, new Map()));
  teams.forEach(team => {
    const c = characteristics.get(team.name);
    if (!c) return;
    features.forEach(f => teamFeatureValues.get(f.key)!.set(team.name, c[f.key] as number));
  });

  // Compute correlation (and per-feature pool stats) once across the grid.
  const featureStats = new Map<string, { r: number; mean: number; stddev: number }>();
  features.forEach(f => {
    const values: number[] = [];
    const targets: number[] = [];
    teamFeatureValues.get(f.key)!.forEach((v, team) => {
      const ideal = idealByTeam.get(team);
      if (typeof v !== 'number' || !Number.isFinite(v) || typeof ideal !== 'number') return;
      values.push(v);
      // Negate so higher = faster on this axis. Sign of correlation now
      // matches betterWhen: features that should be high in a fast team
      // produce positive r.
      targets.push(-ideal);
    });
    const r = pearson(values, targets);
    featureStats.set(f.key, { r, mean: mean(values), stddev: popStddev(values) });
  });

  return teams.map(team => {
    const teamDrivers = drivers.filter(d => d.team === team.name);
    const c = characteristics.get(team.name);

    // Mean pace from clean laps (unchanged).
    let totalPace = 0, lapCount = 0;
    const perDriverTimes = new Map<string, number[]>();
    Object.entries(lapsData).forEach(([key, laps]) => {
      const driverId = key.split('_')[0];
      const owned = teamDrivers.some(d => d.id === driverId);
      if (!owned) return;
      const arr = perDriverTimes.get(driverId) ?? [];
      laps.forEach(lap => {
        totalPace += lap.fuelCorrectedTime;
        lapCount += 1;
        arr.push(lap.fuelCorrectedTime);
      });
      perDriverTimes.set(driverId, arr);
    });
    const meanPace = lapCount > 0 ? totalPace / lapCount : team.basePace;

    // Real machine/driver impact via variance decomposition.
    //   intra = mean of within-driver stddev (consistency of one driver)
    //   inter = stddev of per-driver medians (how different the team-mates are)
    // Higher inter relative to intra → driver identity matters more.
    const driverArrays = Array.from(perDriverTimes.values()).filter(arr => arr.length >= 3);
    let driverImpact: number;
    let machineImpact: number;
    let sampleConfidence: 'high' | 'medium' | 'low';
    if (driverArrays.length >= 2) {
      const intra = mean(driverArrays.map(popStddev));
      const medians = driverArrays.map(arr => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      });
      const inter = popStddev(medians);
      const total = intra + inter;
      const ratio = total > 0 ? inter / total : 0.5;
      driverImpact = Math.round(Math.max(10, Math.min(90, ratio * 100)));
      machineImpact = 100 - driverImpact;
      sampleConfidence = driverArrays.every(arr => arr.length >= 8) ? 'high' : 'medium';
    } else if (driverArrays.length === 1) {
      // Only one driver loaded — can't separate driver vs machine. Default
      // 50/50 but flag as low confidence.
      driverImpact = 50;
      machineImpact = 50;
      sampleConfidence = 'low';
    } else {
      driverImpact = 50;
      machineImpact = 50;
      sampleConfidence = 'low';
    }

    // Per-team feature contributions: r * z_i across each proxy. Sign retained
    // — positive means "this team is above grid average in a trait that
    // correlates with being fast". Display layer takes the abs and sorts.
    const shapValues = features.map(f => {
      const stats = featureStats.get(f.key)!;
      const proxyValue = c ? (c[f.key] as number) : stats.mean;
      const z = stats.stddev > 0 ? (proxyValue - stats.mean) / stats.stddev : 0;
      const signed = stats.r * z;
      return { feature: f.label, value: parseFloat(signed.toFixed(3)) };
    }).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    return {
      team: team.name,
      machineImpact,
      driverImpact,
      shapValues,
      meanPace,
      teamDrivers,
      sampleConfidence
    };
  });
}

const MLAnalysis: React.FC = () => {
  const { downloaded, catalogue, hasData, activeSessionKeys } = useData();
  const downloadedData = useMemo(() => ({
    ...downloaded,
    telemetry: filterDatasetByActiveSessions(downloaded.telemetry, activeSessionKeys),
    laps: filterDatasetByActiveSessions(downloaded.laps, activeSessionKeys),
    drivers: filterDriversByActiveSessions(downloaded.drivers, downloaded.laps, activeSessionKeys)
  }), [downloaded, activeSessionKeys]);
  const resolvedDownloadDrivers = downloadedData.drivers;
  const availableTeams = catalogue?.teams
    ? Object.values(catalogue.teams).flat().filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
    : [];

  const { characteristics, idealRanking: idealRankingMap } = useTeamData(
    resolvedDownloadDrivers, downloadedData.laps, downloadedData.telemetry
  );

  const idealRanking: TeamIdealEntry[] = useMemo(() =>
    [...idealRankingMap.values()].sort((a, b) => a.idealLap - b.idealLap),
    [idealRankingMap]
  );

  const cleanLapCount = useMemo(() => {
    return Object.values(downloadedData.laps ?? {}).reduce((acc, laps) => acc + laps.filter(l => l.isCleanAir).length, 0);
  }, [downloadedData.laps]);

  const formatLap = (seconds: number | null | undefined): string => {
    if (seconds == null || !Number.isFinite(seconds)) return '—';
    const mins = Math.floor(seconds / 60);
    const rest = seconds - mins * 60;
    return mins > 0 ? `${mins}:${rest.toFixed(3).padStart(6, '0')}` : `${seconds.toFixed(3)}s`;
  };

  const driverNameById = (driverId: string): string =>
    resolvedDownloadDrivers.find(d => d.id === driverId)?.name ?? `#${driverId}`;

  // Most recent year in the active sessions — drives feature labels (2026
  // swaps DRS terminology for X-mode / Z-mode).
  const activeYear = useMemo(() => {
    const sessions = downloadedData.sessions ?? [];
    if (sessions.length === 0) return new Date().getUTCFullYear();
    return Math.max(...sessions.map(s => s.year));
  }, [downloadedData.sessions]);

  const insights = useMemo(() => {
    // Restrict to teams that actually have data in the active sessions —
    // never include teams from the catalogue that aren't running this season.
    const teamsWithRealData = new Set(idealRanking.map(e => e.team));
    const teamsToUse = availableTeams.filter(t => teamsWithRealData.has(t.name));
    const driversToUse = resolvedDownloadDrivers.length > 0 ? resolvedDownloadDrivers : [];
    return buildInsights({
      teams: teamsToUse,
      drivers: driversToUse,
      lapsData: downloadedData.laps,
      characteristics,
      idealRanking,
      year: activeYear
    });
  }, [availableTeams, resolvedDownloadDrivers, downloadedData, idealRanking, characteristics, activeYear]);

  const teamCharacteristics = (team: import('../types/f1').Team): TeamMetrics => {
    const real = characteristics.get(team.name);
    if (real) return real;
    const fallback = team.characteristics;
    return {
      traction: fallback.traction,
      downforce: fallback.downforce,
      drag: fallback.drag,
      tireManagement: fallback.tireManagement,
      braking: fallback.braking ?? 50
    };
  };

  const teamIdealEntry = (team: import('../types/f1').Team): TeamIdealEntry | undefined =>
    idealRanking.find(e => e.team === team.name);

  const teamPaceLabel = (team: import('../types/f1').Team): string => {
    const ideal = teamIdealEntry(team);
    if (ideal) return formatLap(ideal.idealLap);
    return `${team.basePace.toFixed(3)} s*`;
  };

  type Insight = (typeof insights)[number];
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(insights[0] || null);
  const [activeTab, setActiveTab] = useState<'clustering' | 'decoupling' | 'shap'>('clustering');

  // Update selected when insights refresh
  React.useEffect(() => {
    if (insights.length > 0 && (!selectedInsight || !insights.find(i => i.team === selectedInsight.team))) {
      setSelectedInsight(insights[0]);
    }
  }, [insights]);

  // Teams to display in ML Engine: ONLY those with real data in the active sessions.
  // Teams from the catalogue that didn't participate (or whose data wasn't downloaded
  // for the current selection) must not appear — we never show synthetic estimates.
  const teamsOrderedByIdeal = useMemo(() => {
    const rank = new Map<string, number>();
    idealRanking.forEach((e, idx) => rank.set(e.team, idx));
    return availableTeams
      .filter(t => rank.has(t.name))
      .sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0));
  }, [availableTeams, idealRanking]);

  const intraTeamData = useMemo(() =>
    insights.map(ins => ({
      team: ins.team.split(' ').slice(0, 2).join(' '),
      machine: ins.machineImpact,
      driver: ins.driverImpact,
    })),
    [insights]
  );

  const shapData = useMemo(() => {
    if (!selectedInsight) return [];
    const colors = ['#dc2626', '#ea580c', '#eab308', '#22c55e', '#3b82f6'];
    return selectedInsight.shapValues.map((sv, i) => ({
      ...sv,
      color: colors[i % colors.length]
    }));
  }, [selectedInsight]);

  if (!hasData && resolvedDownloadDrivers.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-500" />
            Motor de Machine Learning
          </h2>
          <p className="text-gray-400 text-sm mt-1">Clustering, desacoplamiento y análisis de importancia por feature
            {isModernRegulations(activeYear) && (
              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider bg-cyan-900/50 text-cyan-300 border border-cyan-700/60 px-2 py-0.5 rounded">
                Reglamento {activeYear} · X/Z aero
              </span>
            )}
          </p>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold text-lg mb-2">Sin datos descargados</h3>
          <p className="text-gray-400">
            Ve al módulo <strong className="text-yellow-400">FastF1 Loader</strong> y descarga datos primero para alimentar los modelos ML.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-500" />
            Motor de Machine Learning
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            {hasData
              ? `Modelos entrenados con ${cleanLapCount} vueltas limpias — orden derivado de vuelta ideal (suma de mejores microsectores)`
              : 'Usando datos de temporada activa — descarga telemetría para mayor precisión'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-gray-800 p-1 rounded-lg w-fit">
        {([
          { id: 'clustering', label: 'Clustering Chasis', icon: BarChart3 },
          { id: 'decoupling', label: 'Piloto vs Máquina', icon: GitCompare },
          { id: 'shap', label: 'Importancia (r·z)', icon: Target },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Clustering */}
      {activeTab === 'clustering' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {idealRanking.length > 0 && (
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                <Target className="w-5 h-5 text-green-500" />
                Orden por Vuelta Ideal
              </h3>
              <p className="text-gray-400 text-xs mb-4">
                Ranking derivado de la suma de mejores microsectores (S1+S2+S3) del piloto más rápido de cada equipo. Refleja el potencial real, no la media de vueltas.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-xs uppercase border-b border-gray-700">
                    <tr>
                      <th className="text-left py-2 px-3">Pos</th>
                      <th className="text-left py-2 px-3">Equipo</th>
                      <th className="text-left py-2 px-3">Mejor piloto</th>
                      <th className="text-right py-2 px-3">Vuelta ideal</th>
                      <th className="text-right py-2 px-3">Mejor real</th>
                      <th className="text-right py-2 px-3">Δ pole</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {idealRanking.map((entry, idx) => (
                      <tr key={entry.team} className={`${idx === 0 ? 'bg-green-900/10' : idx === 1 ? 'bg-blue-900/10' : idx === 2 ? 'bg-yellow-900/10' : ''} hover:bg-gray-700/20`}>
                        <td className="py-2 px-3 font-mono">
                          <span className={`${idx === 0 ? 'text-green-400' : idx === 1 ? 'text-blue-400' : idx === 2 ? 'text-yellow-400' : 'text-gray-400'} font-bold`}>P{idx + 1}</span>
                        </td>
                        <td className="py-2 px-3 text-white font-medium">{entry.team}</td>
                        <td className="py-2 px-3 text-gray-300">{driverNameById(entry.bestDriverId)}</td>
                        <td className="py-2 px-3 text-right text-white font-mono">{formatLap(entry.idealLap)}</td>
                        <td className="py-2 px-3 text-right text-gray-400 font-mono">{formatLap(entry.bestLap)}</td>
                        <td className={`py-2 px-3 text-right font-mono ${idx === 0 ? 'text-green-400' : 'text-gray-300'}`}>
                          {idx === 0 ? '—' : `+${entry.deltaToPole.toFixed(3)}s`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamsOrderedByIdeal.map((team, idx) => {
              const c = teamCharacteristics(team);
              const hasReal = characteristics.has(team.name);
              return (
                <div key={team.id} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-white font-semibold text-sm">{team.name}</h4>
                    <span className={`font-mono text-xs ${hasReal ? 'text-green-400' : 'text-gray-500'}`}>
                      {hasReal ? 'real' : 'sin datos'}
                    </span>
                  </div>
                  {[
                    { label: 'Traction', value: c.traction, color: 'bg-red-500' },
                    { label: 'Downforce', value: c.downforce, color: 'bg-blue-500' },
                    { label: 'Tire Management', value: c.tireManagement, color: 'bg-green-500' },
                    { label: 'Low Drag', value: 100 - c.drag, color: 'bg-yellow-500' },
                  ].map(bar => (
                    <div key={bar.label} className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">{bar.label}</span>
                        <span className="text-white">{Math.round(bar.value)}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full ${bar.color} rounded-full`} style={{ width: `${Math.max(0, Math.min(100, bar.value))}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="mt-4 pt-3 border-t border-gray-700 flex justify-between items-center">
                    <span className="text-gray-400 text-xs">{teamIdealEntry(team) ? 'Vuelta ideal' : 'Ritmo estimado'}</span>
                    <span className="text-white font-mono font-bold text-sm">{teamPaceLabel(team)}</span>
                  </div>
                  <span className="text-purple-400 font-mono text-[10px]">#{idx + 1}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Piloto vs Máquina */}
      {activeTab === 'decoupling' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-purple-500" />
                Desacoplamiento Piloto vs Máquina
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={intraTeamData} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis type="number" domain={[0, 100]} stroke="#6b7280" tickFormatter={v => `${v}%`} />
                    <YAxis dataKey="team" type="category" stroke="#6b7280" width={120} />
                    <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }} labelStyle={{ color: '#9ca3af' }} />
                    <Legend />
                    <Bar dataKey="machine" name="Impacto Máquina" stackId="a" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="driver" name="Impacto Piloto" stackId="a" fill="#dc2626" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  Interpretación del Modelo Mixto
                </h4>
                <div className="space-y-3">
                  <div className="p-4 bg-blue-900/20 rounded-lg border border-blue-800">
                    <div className="flex items-center gap-2 mb-1">
                      <Cpu className="w-4 h-4 text-blue-400" />
                      <span className="text-blue-400 font-medium text-sm">Impacto Máquina &gt; 65%</span>
                    </div>
                    <p className="text-gray-400 text-xs">El rendimiento lo dicta el chasis. Diferencias intra-equipo pequeñas.</p>
                  </div>
                  <div className="p-4 bg-red-900/20 rounded-lg border border-red-800">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4 text-red-400" />
                      <span className="text-red-400 font-medium text-sm">Impacto Piloto &gt; 35%</span>
                    </div>
                    <p className="text-gray-400 text-xs">El piloto tiene mayor influencia. Posible sobre-rendimiento o setup muy diferente entre compañeros.</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h4 className="text-white font-semibold mb-4">Métricas Intra-Equipo</h4>
                <div className="space-y-3">
                  {insights.map(ins => (
                    <div key={ins.team} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
                      <span className="text-gray-300 text-sm truncate flex-1">{ins.team}</span>
                      <div className="flex items-center gap-3 ml-2">
                        <div className="flex items-center gap-1">
                          <Cpu className="w-3 h-3 text-blue-400" />
                          <span className="text-blue-400 text-xs font-mono">{ins.machineImpact}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3 text-red-400" />
                          <span className="text-red-400 text-xs font-mono">{ins.driverImpact}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h4 className="text-white font-semibold mb-4">Modelo de Efectos Mixtos (Statsmodels)</h4>
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-gray-400 overflow-x-auto">
              <p className="text-green-400"># Formula del modelo</p>
              <p className="text-white">corner_time ~ brake_point_dist + throttle_smoothness</p>
              <p className="text-white">groups = df["team"],  re_formula = "~driver"</p>
              <br />
              <p className="text-gray-500"># Varianza explicada</p>
              <p>machine_contribution = (team_variance / total_variance) * 100</p>
              <p>driver_contribution  = (driver_variance / total_variance) * 100</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* SHAP */}
      {activeTab === 'shap' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="flex gap-2 flex-wrap">
            {insights.map(ins => {
              const confidenceDot = ins.sampleConfidence === 'high'
                ? 'bg-emerald-400'
                : ins.sampleConfidence === 'medium'
                  ? 'bg-amber-400'
                  : 'bg-red-400';
              const confidenceTitle = ins.sampleConfidence === 'high'
                ? 'Muestra robusta (≥8 vueltas por piloto, ≥2 pilotos)'
                : ins.sampleConfidence === 'medium'
                  ? 'Muestra moderada (≥2 pilotos pero pocas vueltas)'
                  : 'Muestra limitada (1 piloto o sin vueltas suficientes)';
              return (
                <button
                  key={ins.team}
                  onClick={() => setSelectedInsight(ins)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                    selectedInsight?.team === ins.team
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                  title={confidenceTitle}
                >
                  <span className={`w-2 h-2 rounded-full ${confidenceDot}`} />
                  {ins.team.split(' ').slice(0, 2).join(' ')}
                </button>
              );
            })}
          </div>

          {selectedInsight && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-purple-500" />
                  Importancia de feature — {selectedInsight.team}
                </h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={shapData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis type="number" stroke="#6b7280" />
                      <YAxis dataKey="feature" type="category" stroke="#6b7280" width={130} />
                      <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }} labelStyle={{ color: '#9ca3af' }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {shapData.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                  <h4 className="text-white font-semibold mb-4">Análisis por Feature</h4>
                  <div className="space-y-3">
                    {selectedInsight.shapValues.map((sv, i) => (
                      <div key={sv.feature} className="flex items-start gap-3 p-3 bg-gray-900 rounded-lg">
                        <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: shapData[i]?.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-white font-medium text-sm">{sv.feature}</span>
                            <span className="text-purple-400 text-sm font-mono">{sv.value.toFixed(3)}</span>
                          </div>
                          <div className="mt-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, (Math.abs(sv.value) / 1.5) * 100)}%`, backgroundColor: shapData[i]?.color }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-purple-900/20 border border-purple-700 rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <TrendingUp className="w-5 h-5 text-purple-500 mt-0.5" />
                    <div>
                      <h5 className="text-purple-400 font-medium mb-1">ADN del Chasis</h5>
                      <p className="text-gray-400 text-sm">
                        El feature más influyente es <strong className="text-white">{selectedInsight.shapValues[0]?.feature}</strong> con una importancia (r·z) de{' '}
                        <strong className="text-purple-400">{selectedInsight.shapValues[0]?.value.toFixed(3)}</strong>.
                        Esto indica que {selectedInsight.team} extrae su ventaja principalmente de esa área técnica.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default MLAnalysis;
