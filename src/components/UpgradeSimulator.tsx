import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import type { Circuit } from '../types/f1';
import {
  calculateTopologyMismatch,
  estimateCircuitBaseTime,
  type TeamMetrics
} from '../lib/teamMetrics';
import { filterDatasetByActiveSessions, filterDriversByActiveSessions } from '../lib/activeDataset';
import { useTeamData } from '../hooks/useTeamData';
import {
  Zap,
  Wrench,
  ArrowUpDown,
  CircleStop,
  Weight,
  RotateCcw,
  Gauge,
  TrendingUp,
  Table2,
  ChevronDown
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList
} from 'recharts';
import { motion } from 'framer-motion';

interface UpgradePart {
  id: string;
  label: string;
  icon: React.ReactNode;
  effects: Partial<Record<keyof TeamMetrics, number>>;
  description: string;
}

const UPGRADE_PARTS: UpgradePart[] = [
  { id: 'engine', label: 'Engine Power', icon: <Zap className="w-4 h-4" />,
    effects: { drag: 5 }, description: 'Top speed' },
  { id: 'chassis', label: 'Chassis', icon: <Wrench className="w-4 h-4" />,
    effects: { traction: 3, tireManagement: 2, braking: 1 }, description: 'Grip, tire life, braking' },
  { id: 'frontWing', label: 'Front Wing', icon: <ArrowUpDown className="w-4 h-4" />,
    effects: { downforce: 5, drag: -3 }, description: '+ cornering, - top speed' },
  { id: 'rearWing', label: 'Rear Wing', icon: <ArrowUpDown className="w-4 h-4" />,
    effects: { downforce: 3, drag: -4 }, description: '+ cornering, - top speed' },
  { id: 'brakes', label: 'Brakes', icon: <CircleStop className="w-4 h-4" />,
    effects: { braking: 8 }, description: 'Braking perf' },
  { id: 'weight', label: 'Weight Saving', icon: <Weight className="w-4 h-4" />,
    effects: { tireManagement: 2, traction: 1, braking: 1 }, description: 'All-round' },
];

type SliderValues = Record<string, number>;

const QUICK_SETUPS: Record<string, SliderValues> = {
  monaco: { engine: 0, chassis: 2, frontWing: 3, rearWing: 3, brakes: 2, weight: 1 },
  monza: { engine: 3, chassis: 0, frontWing: -2, rearWing: -3, brakes: 0, weight: 0 },
  balanced: { engine: 1, chassis: 1, frontWing: 1, rearWing: 1, brakes: 1, weight: 1 },
};

const METRIC_LABELS: Record<keyof TeamMetrics, string> = {
  downforce: 'Downforce',
  drag: 'Top Speed',
  traction: 'Traction',
  tireManagement: 'Tire Mgmt',
  braking: 'Braking',
};

const UpgradeSimulator: React.FC = () => {
  const { catalogue, downloaded: downloadedRaw, activeSessionKeys } = useData();
  const downloaded = useMemo(() => ({
    ...downloadedRaw,
    telemetry: filterDatasetByActiveSessions(downloadedRaw.telemetry, activeSessionKeys),
    laps: filterDatasetByActiveSessions(downloadedRaw.laps, activeSessionKeys),
    drivers: filterDriversByActiveSessions(downloadedRaw.drivers, downloadedRaw.laps, activeSessionKeys),
    sessions: downloadedRaw.sessions.filter(s => activeSessionKeys.size === 0 || activeSessionKeys.has(`${s.year}_${s.round}_${s.sessionType}`))
  }), [downloadedRaw, activeSessionKeys]);

  const [selectedTeam, setSelectedTeam] = useState('');
  const [sliders, setSliders] = useState<SliderValues>(() =>
    Object.fromEntries(UPGRADE_PARTS.map(p => [p.id, 0]))
  );

  const { characteristics, idealRanking, teamKeys: teamOptions } = useTeamData(
    downloaded.drivers, downloaded.laps, downloaded.telemetry
  );
  const selectedTeamChars = selectedTeam ? characteristics.get(selectedTeam) : undefined;
  const selectedTeamIdeal = selectedTeam ? idealRanking.get(selectedTeam)?.idealLap : undefined;

  const baseChars = useMemo((): TeamMetrics => selectedTeam && selectedTeamChars ? selectedTeamChars : { downforce: 50, drag: 50, traction: 50, tireManagement: 50, braking: 50 }, [selectedTeamChars, selectedTeam]);

  const modifiedChars = useMemo((): TeamMetrics => {
    const delta: TeamMetrics = { downforce: 0, drag: 0, traction: 0, tireManagement: 0, braking: 0 };
    UPGRADE_PARTS.forEach(part => {
      const val = sliders[part.id] ?? 0;
      (Object.keys(part.effects) as (keyof TeamMetrics)[]).forEach(key => {
        const effect = part.effects[key];
        if (effect) delta[key] += val * effect;
      });
    });
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    return {
      downforce: clamp(baseChars.downforce + delta.downforce),
      drag: clamp(baseChars.drag + delta.drag),
      traction: clamp(baseChars.traction + delta.traction),
      tireManagement: clamp(baseChars.tireManagement + delta.tireManagement),
      braking: clamp(baseChars.braking + delta.braking),
    };
  }, [baseChars, sliders]);

  const metricsDelta = useMemo(() => {
    const out: Array<{ metric: string; base: number; modified: number; diff: number; label: string }> = [];
    (Object.keys(METRIC_LABELS) as (keyof TeamMetrics)[]).forEach(k => {
      const b = baseChars[k];
      const m = modifiedChars[k];
      out.push({ metric: k, base: b, modified: m, diff: m - b, label: METRIC_LABELS[k] });
    });
    return out;
  }, [baseChars, modifiedChars]);

  const circuits = useMemo(() => catalogue?.circuits ?? [], [catalogue]);

  const circuitImpacts = useMemo(() => {
    if (!selectedTeam) return [];
    return circuits.map(c => {
      const before = calculateTopologyMismatch(baseChars, c as Circuit, 'R');
      const after = calculateTopologyMismatch(modifiedChars, c as Circuit, 'R');
      const lapDelta = after - before;
      const raceLaps = 57;
      return {
        circuitId: c.id,
        circuitName: c.name,
        lapDelta,
        raceDelta: lapDelta * raceLaps,
        color: lapDelta < 0 ? '#22c55e' : lapDelta > 0 ? '#ef4444' : '#6b7280',
      };
    }).sort((a, b) => a.lapDelta - b.lapDelta);
  }, [selectedTeam, baseChars, modifiedChars, circuits]);

  const raceForecast = useMemo(() => {
    if (!selectedTeam || circuits.length === 0) return [];
    const entries: Array<{ team: string; before: number; after: number }> = [];
    idealRanking.forEach((entry, team) => {
      const chars = characteristics.get(team) ?? baseChars;
      const before = entry.idealLap;
      const after = team === selectedTeam
        ? estimateCircuitBaseTime((circuits[0] as Circuit).profile, (circuits[0] as Circuit).length) + calculateTopologyMismatch(modifiedChars, circuits[0] as Circuit, 'R') + (entry.idealLap - estimateCircuitBaseTime((circuits[0] as Circuit).profile, (circuits[0] as Circuit).length) - calculateTopologyMismatch(chars, circuits[0] as Circuit, 'Q'))
        : before;
      entries.push({ team, before, after });
    });
    entries.sort((a, b) => a.after - b.after);
    const fastest = entries[0]?.after ?? 0;
    return entries.map(e => ({
      team: e.team,
      beforeTime: e.before,
      afterTime: e.after,
      gapToLeader: e.after - fastest,
      delta: e.after - e.before,
      isUpgraded: e.team === selectedTeam,
    }));
  }, [selectedTeam, idealRanking, characteristics, baseChars, modifiedChars, circuits]);

  const setPreset = (name: string) => {
    const preset = QUICK_SETUPS[name];
    if (preset) setSliders({ ...preset });
  };

  const resetSliders = () => {
    setSliders(Object.fromEntries(UPGRADE_PARTS.map(p => [p.id, 0])));
  };

  const currentTotalGain = selectedTeam ? circuitImpacts.reduce((s, c) => s + c.raceDelta, 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Gauge className="w-6 h-6 text-orange-500" />
            Upgrade Simulator
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Simula mejoras en componentes del coche y visualiza el impacto por circuito
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Controls */}
        <div className="space-y-6">
          {/* Team Selector */}
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <label className="block text-gray-400 text-sm mb-2">Equipo a mejorar</label>
            <div className="relative">
              <select
                value={selectedTeam}
                onChange={e => setSelectedTeam(e.target.value)}
                className="w-full appearance-none bg-gray-900 border border-gray-700 text-white px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 pr-10"
              >
                <option value="">Seleccionar equipo...</option>
                {teamOptions.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            </div>
            {typeof selectedTeamIdeal === 'number' && (
              <p className="text-xs text-gray-500 mt-2">
                Vuelta ideal base: <span className="text-white font-mono">{selectedTeamIdeal.toFixed(3)}s</span>
              </p>
            )}
          </div>

          {/* Quick Setup */}
          {selectedTeam && (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <label className="block text-gray-400 text-sm mb-3">Quick Setup</label>
              <div className="flex gap-2">
                <button onClick={() => setPreset('monaco')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-gray-900 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-all">
                  Monaco
                </button>
                <button onClick={() => setPreset('monza')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-gray-900 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-all">
                  Monza
                </button>
                <button onClick={() => setPreset('balanced')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-gray-900 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-all">
                  Balanced
                </button>
                <button onClick={resetSliders}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-gray-900 text-red-400 hover:bg-gray-700 border border-gray-700 transition-all">
                  <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                  Reset
                </button>
              </div>
            </div>
          )}

          {/* Sliders */}
          {selectedTeam && (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <label className="block text-gray-400 text-sm mb-3">Upgrades</label>
              <div className="space-y-4">
                {UPGRADE_PARTS.map(part => {
                  const val = sliders[part.id] ?? 0;
                  return (
                    <div key={part.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400">{part.icon}</span>
                          <span className="text-white text-sm">{part.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono font-bold ${val > 0 ? 'text-green-400' : val < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                            {val > 0 ? `+${val}` : val}
                          </span>
                          <ChevronDown className="w-3 h-3 text-gray-600" />
                        </div>
                      </div>
                      <input
                        type="range"
                        min="-3"
                        max="3"
                        step="1"
                        value={val}
                        onChange={e => setSliders(s => ({ ...s, [part.id]: Number(e.target.value) }))}
                        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-600 mt-0.5 px-0.5">
                        <span>-3</span>
                        <span>{part.description}</span>
                        <span>+3</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metrics Delta */}
          {selectedTeam && (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <label className="block text-gray-400 text-sm mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                Metrics
              </label>
              <div className="space-y-2.5">
                {metricsDelta.map(m => {
                  const pct = Math.max(0, Math.min(100, m.modified));
                  return (
                    <div key={m.metric}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">{m.label}</span>
                        <span className="font-mono text-white">{m.base.toFixed(0)}
                          <span className={`${m.diff > 0 ? 'text-green-400' : m.diff < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                            {' '}{m.diff > 0 ? '+' : ''}{m.diff.toFixed(0)}
                          </span>
                        </span>
                      </div>
                      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-orange-600 to-orange-400 transition-all duration-300"
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="text-xs text-gray-400">Ganancia total estimada</div>
                <div className="text-lg font-bold font-mono text-green-400">
                  {currentTotalGain < 0 ? `${currentTotalGain.toFixed(1)}s` : '—'}
                </div>
                <div className="text-[10px] text-gray-500">promedio en 57 vueltas</div>
              </div>
            </div>
          )}

          {!selectedTeam && (
            <div className="bg-gray-800/50 rounded-xl p-8 border border-gray-700 border-dashed text-center">
              <Gauge className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <h3 className="text-gray-400 font-medium mb-1">Selecciona un equipo</h3>
              <p className="text-gray-500 text-xs">Elige un equipo para empezar a simular mejoras</p>
            </div>
          )}
        </div>

        {/* Right: Results */}
        <div className="xl:col-span-2 space-y-6">
          {/* Circuit Impact Chart */}
          {selectedTeam && circuitImpacts.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                Impacto por Circuito (s/vuelta)
              </h3>
              <p className="text-[10px] text-gray-500 mb-3">Negativo = mejora. Ordenado de mayor a menor ganancia.</p>
              <div style={{ height: Math.max(200, circuitImpacts.length * 28) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={circuitImpacts} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 70 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                    <XAxis type="number" stroke="#6b7280" tickFormatter={(v: unknown) => { const val = v as number; return `${val > 0 ? '+' : ''}${(val * 1000).toFixed(0)}ms`; }} domain={['dataMin - 0.02', 'dataMax + 0.02']} />
                    <YAxis type="category" dataKey="circuitName" stroke="#9ca3af" tick={{ fontSize: 11 }} width={70} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }}
                      formatter={(value: unknown) => {
                        const v = value as number;
                        const ms = v * 1000;
                        return [`${ms < 0 ? '' : '+'}${ms.toFixed(1)}ms`, 'Δ s/vuelta'];
                      }}
                    />
                    <Bar dataKey="lapDelta" radius={[0, 3, 3, 0]}>
                      {circuitImpacts.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                      <LabelList dataKey="lapDelta" position="right"
                        formatter={(v: unknown) => {
                          const val = v as number;
                          return `${val < 0 ? '' : '+'}${(val * 1000).toFixed(0)}ms`;
                        }}
                        fill="#9ca3af" style={{ fontSize: 10, fontFamily: 'monospace' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* Race Forecast */}
          {selectedTeam && raceForecast.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <Table2 className="w-4 h-4 text-blue-400" />
                Pronóstico Comparativo ({circuits[0]?.name ?? '—'})
              </h3>
              <p className="text-[10px] text-gray-500 mb-3">Tiempos por vuelta (base + topología + residual). Equipo mejorado destacado.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left text-gray-400 font-medium py-2">Pos</th>
                      <th className="text-left text-gray-400 font-medium py-2">Equipo</th>
                      <th className="text-right text-gray-400 font-medium py-2">Before</th>
                      <th className="text-right text-gray-400 font-medium py-2">After</th>
                      <th className="text-right text-gray-400 font-medium py-2">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raceForecast.map((row, i) => (
                      <tr key={row.team} className={`border-b border-gray-700/50 ${row.isUpgraded ? 'bg-orange-900/20' : ''}`}>
                        <td className="py-2 text-gray-400 font-mono">{i + 1}</td>
                        <td className={`py-2 font-medium ${row.isUpgraded ? 'text-orange-300' : 'text-white'}`}>
                          {row.team} {row.isUpgraded && <span className="text-[10px] text-orange-500 ml-1">▲</span>}
                        </td>
                        <td className="py-2 text-right text-gray-400 font-mono">{row.beforeTime.toFixed(3)}s</td>
                        <td className="py-2 text-right text-white font-mono">{row.afterTime.toFixed(3)}s</td>
                        <td className={`py-2 text-right font-mono ${row.delta < 0 ? 'text-green-400' : row.delta > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {row.delta < 0 ? row.delta.toFixed(3) : row.delta > 0 ? `+${row.delta.toFixed(3)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* No team selected info */}
          {!selectedTeam && (
            <div className="bg-gray-800/50 rounded-xl p-12 border border-gray-700 border-dashed text-center">
              <Gauge className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-400 mb-2">Upgrade Simulator</h3>
              <p className="text-gray-500 text-sm">Selecciona un equipo y ajusta los sliders para ver el impacto</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpgradeSimulator;
