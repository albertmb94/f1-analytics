import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { linearSlope } from '../lib/teamMetrics';
import { filterDatasetByActiveSessions } from '../lib/activeDataset';
import {
  Activity,
  Fuel,
  Wind,
  TrendingDown,
  Filter,
  Gauge,
  AlertCircle
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell
} from 'recharts';
import { motion } from 'framer-motion';

const TelemetryProcessing: React.FC = () => {
  const { downloaded, hasData, activeSessionKeys } = useData();
  const downloadedData = useMemo(() => ({
    ...downloaded,
    telemetry: filterDatasetByActiveSessions(downloaded.telemetry, activeSessionKeys),
    laps: filterDatasetByActiveSessions(downloaded.laps, activeSessionKeys),
    sessions: downloaded.sessions.filter(s => activeSessionKeys.size === 0 || activeSessionKeys.has(`${s.year}_${s.round}_${s.sessionType}`))
  }), [downloaded, activeSessionKeys]);
  const resolvedDownloadDrivers = downloaded.drivers;
  const resolvedDownloadSessions = downloadedData.sessions;
  const availableDrivers = downloaded.drivers;

  // Drivers and sessions available from downloaded data
  const activeDrivers = useMemo(() => {
    if (!hasData) return availableDrivers.slice(0, 6);
    const ids = new Set(
      Object.keys(downloadedData.telemetry).map(k => k.split('_')[0])
    );
    return resolvedDownloadDrivers.filter(d => ids.has(d.id));
  }, [hasData, downloadedData, resolvedDownloadDrivers, availableDrivers]);

  const activeSessions = useMemo(() => {
    if (!hasData) return [];
    const sessionKeys = new Set(
      Object.keys(downloadedData.telemetry).map(k => k.split('_').slice(1).join('_'))
    );
    return resolvedDownloadSessions.filter(s => {
      const key = `${s.year}_${s.round}_${s.sessionType}`;
      return sessionKeys.has(key);
    });
  }, [hasData, downloadedData, resolvedDownloadSessions]);

  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>('');
  const [activeProcess, setActiveProcess] = useState<'raw' | 'fuel' | 'clean' | 'degradation'>('raw');

  // Resolve current driver and session
  const driver = activeDrivers.find(d => d.id === selectedDriverId) || activeDrivers[0];
  const session = activeSessions.find(s => `${s.year}_${s.round}_${s.sessionType}` === selectedSessionKey) || activeSessions[0];

  // Build lookup key and get data
  const dataKey = driver && session
    ? `${driver.id}_${session.year}_${session.round}_${session.sessionType}`
    : null;

  const telemetry = useMemo(() => {
    if (!dataKey) return [];
    return downloadedData.telemetry[dataKey] || [];
  }, [dataKey, downloadedData]);

  const laps = useMemo(() => {
    if (!dataKey) return [];
    return downloadedData.laps[dataKey] || [];
  }, [dataKey, downloadedData]);

  // Fuel correction
  const fuelCorrectedLaps = useMemo(() => {
    return laps.map(lap => ({
      ...lap,
      fuelCorrection: (laps.length - lap.number) * 0.035
    }));
  }, [laps]);

  // Clean air filter stats
  const cleanAirStats = useMemo(() => {
    const cleanLaps = laps.filter(l => l.isCleanAir);
    const dirtyLaps = laps.filter(l => !l.isCleanAir);
    return {
      cleanCount: cleanLaps.length,
      dirtyCount: dirtyLaps.length,
      cleanAvg: cleanLaps.length ? cleanLaps.reduce((a, b) => a + b.time, 0) / cleanLaps.length : 0,
      dirtyAvg: dirtyLaps.length ? dirtyLaps.reduce((a, b) => a + b.time, 0) / dirtyLaps.length : 0
    };
  }, [laps]);

  // Real per-compound degradation stats derived from clean laps:
  //  - optimal window (range of tireAge where lap time stays within +0.5s of the best)
  //  - degradation slope (s lost per lap, linear fit on fuel-corrected time)
  //  - best lap of the compound and peak loss (worst delta seen).
  const compoundStats = useMemo(() => {
    type Stat = {
      laps: number;
      slope: number;
      degOver30: number;
      bestLap: number;
      peakLoss: number;
      windowStart: number;
      windowEnd: number;
    };
    const stats: Record<'Soft' | 'Medium' | 'Hard', Stat | null> = { Soft: null, Medium: null, Hard: null };
    (['Soft', 'Medium', 'Hard'] as const).forEach(compound => {
      const compoundLaps = laps
        .filter(l => l.tireCompound === compound && l.time > 60 && l.time < 200)
        .sort((a, b) => a.tireAge - b.tireAge);
      if (compoundLaps.length < 3) return;
      const xs = compoundLaps.map(l => l.tireAge);
      const ys = compoundLaps.map(l => l.fuelCorrectedTime);
      const slope = linearSlope(xs, ys);
      const bestLap = Math.min(...ys);
      const peakLoss = Math.max(...ys) - bestLap;
      const inWindow = compoundLaps.filter(l => l.fuelCorrectedTime - bestLap < 0.5).map(l => l.tireAge);
      stats[compound] = {
        laps: compoundLaps.length,
        slope,
        degOver30: slope * 30,
        bestLap,
        peakLoss,
        windowStart: inWindow.length > 0 ? Math.min(...inWindow) : 0,
        windowEnd: inWindow.length > 0 ? Math.max(...inWindow) : 0
      };
    });
    return stats;
  }, [laps]);

  const degradationData = useMemo(() => {
    const byCompound: Record<string, { tireAge: number[]; deltas: number[] }> = {};
    const compounds: Array<'Soft' | 'Medium' | 'Hard'> = ['Soft', 'Medium', 'Hard'];

    compounds.forEach(compound => {
      const compoundLaps = laps.filter(l => l.tireCompound === compound).sort((a, b) => a.tireAge - b.tireAge);
      if (!compoundLaps.length) {
        byCompound[compound] = { tireAge: [], deltas: [] };
        return;
      }
      const baseline = Math.min(...compoundLaps.map(l => l.fuelCorrectedTime));
      byCompound[compound] = {
        tireAge: compoundLaps.map(l => l.tireAge),
        deltas: compoundLaps.map(l => Number((l.fuelCorrectedTime - baseline).toFixed(3)))
      };
    });

    const ages = Array.from(new Set([
      ...byCompound.Soft.tireAge,
      ...byCompound.Medium.tireAge,
      ...byCompound.Hard.tireAge,
    ])).sort((a, b) => a - b);

    return ages.map(age => ({
      tireAge: age,
      soft: byCompound.Soft.deltas[byCompound.Soft.tireAge.indexOf(age)] ?? null,
      medium: byCompound.Medium.deltas[byCompound.Medium.tireAge.indexOf(age)] ?? null,
      hard: byCompound.Hard.deltas[byCompound.Hard.tireAge.indexOf(age)] ?? null,
    }));
  }, [laps]);

  const noData = !hasData;

  if (noData) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-red-500" />
            Preprocesamiento de Telemetría
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Normalización de combustible, filtrado de aire limpio y análisis de degradación
          </p>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold text-lg mb-2">Datos no descargados</h3>
          <p className="text-gray-400">
            Ve al módulo <strong className="text-yellow-400">FastF1 Loader</strong>, selecciona temporadas, eventos y pilotos, y pulsa <strong className="text-yellow-400">Iniciar Descarga FastF1</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-red-500" />
            Preprocesamiento de Telemetría
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Datos descargados desde FastF1 — {Object.keys(downloadedData.telemetry).length} datasets
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {/* Driver selector */}
          <select
            value={driver?.id || ''}
            onChange={e => setSelectedDriverId(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {activeDrivers.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {/* Session selector */}
          {activeSessions.length > 0 && (
            <select
              value={session ? `${session.year}_${session.round}_${session.sessionType}` : ''}
              onChange={e => setSelectedSessionKey(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {activeSessions.map(s => (
                <option key={`${s.year}_${s.round}_${s.sessionType}`} value={`${s.year}_${s.round}_${s.sessionType}`}>
                  {s.year} R{s.round} {s.sessionType}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Process Tabs */}
      <div className="flex gap-2 bg-gray-800 p-1 rounded-lg w-fit overflow-x-auto">
        {([
          { id: 'raw', label: 'Datos Crudos', icon: Gauge },
          { id: 'fuel', label: 'Corrección Combustible', icon: Fuel },
          { id: 'clean', label: 'Filtro Aire Limpio', icon: Wind },
          { id: 'degradation', label: 'Degradación Real', icon: TrendingDown },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveProcess(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
              activeProcess === id
                ? 'bg-red-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── RAW ── */}
      {activeProcess === 'raw' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Gauge className="w-5 h-5 text-red-500" />
              Telemetría Cruda — Velocidad vs Distancia
            </h3>
            {telemetry.length === 0 ? (
              <p className="text-gray-500 text-center py-12">Sin telemetría para este piloto/sesión</p>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={telemetry}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="distance" stroke="#6b7280" tickFormatter={v => `${Math.round(v as number)}m`} />
                    <YAxis stroke="#6b7280" domain={[0, 360]} />
                    <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }} labelStyle={{ color: '#9ca3af' }} />
                    <Line type="monotone" dataKey="speed" stroke={driver?.color || '#dc2626'} strokeWidth={2} dot={false} name="Speed (km/h)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-sm mb-1">Velocidad Máxima</div>
              <div className="text-2xl font-bold text-white">
                {telemetry.length ? Math.max(...telemetry.map(t => t.speed)).toFixed(0) : '—'} km/h
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-sm mb-1">Velocidad Media</div>
              <div className="text-2xl font-bold text-white">
                {telemetry.length ? (telemetry.reduce((a, b) => a + b.speed, 0) / telemetry.length).toFixed(0) : '—'} km/h
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-sm mb-1">RPM Máximo</div>
              <div className="text-2xl font-bold text-white">
                {telemetry.length ? Math.max(...telemetry.map(t => t.rpm)).toFixed(0) : '—'}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-sm mb-1">DRS Activaciones</div>
              <div className="text-2xl font-bold text-white">
                {telemetry.filter(t => t.drs).length}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── FUEL ── */}
      {activeProcess === 'fuel' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Fuel className="w-5 h-5 text-yellow-500" />
              Corrección de Combustible (±0.035 s/10 kg)
            </h3>
            {laps.length === 0 ? (
              <p className="text-gray-500 text-center py-12">Sin vueltas para este piloto/sesión</p>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={fuelCorrectedLaps}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="number" stroke="#6b7280" label={{ value: 'Vuelta', position: 'bottom', fill: '#6b7280' }} />
                    <YAxis stroke="#6b7280" domain={['dataMin - 0.5', 'dataMax + 0.5']} tickFormatter={v => (v as number).toFixed(2)} label={{ value: 'Tiempo (s)', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }} labelStyle={{ color: '#9ca3af' }} />
                    <Legend />
                    <Line type="monotone" dataKey="time" stroke="#6b7280" strokeWidth={2} dot={false} name="Tiempo Bruto" strokeDasharray="5 5" />
                    <Line type="monotone" dataKey="fuelCorrectedTime" stroke="#22c55e" strokeWidth={2} dot={false} name="Tiempo Corregido" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h4 className="text-white font-semibold mb-4">Parámetros</h4>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Consumo/vuelta</span><span className="text-white font-mono">2.5 kg</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Efecto combustible</span><span className="text-white font-mono">0.035 s/10 kg</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Total vueltas</span><span className="text-white font-mono">{laps.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Sesión</span><span className="text-white font-mono">{session ? `${session.year} R${session.round} ${session.sessionType}` : '—'}</span></div>
              </div>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Fuel className="w-5 h-5 text-yellow-500 mt-0.5" />
                <p className="text-yellow-200/70 text-sm">La corrección de combustible aísla el ritmo base eliminando el peso decreciente durante la carrera.</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── CLEAN AIR ── */}
      {activeProcess === 'clean' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Wind className="w-5 h-5 text-blue-500" />
                Vueltas en Aire Limpio vs Aire Sucio
              </h3>
              {laps.length === 0 ? (
                <p className="text-gray-500 text-center py-12">Sin vueltas para este piloto/sesión</p>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis type="number" dataKey="number" name="Vuelta" stroke="#6b7280" label={{ value: 'Número de Vuelta', position: 'bottom', offset: -10, fill: '#6b7280' }} />
                      <YAxis type="number" dataKey="time" name="Tiempo" stroke="#6b7280" domain={['dataMin - 0.2', 'dataMax + 0.2']} tickFormatter={v => (v as number).toFixed(2)} label={{ value: 'Tiempo (s)', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                      <ZAxis type="number" dataKey="gapToLeader" range={[50, 200]} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                        if (active && payload?.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-lg">
                              <p className="text-white font-semibold">Vuelta {d.number}</p>
                              <p className="text-gray-400 text-sm">Tiempo: {Number(d.time).toFixed(3)} s</p>
                              <p className="text-gray-400 text-sm">Gap: {Number(d.gapToLeader ?? 0).toFixed(2)} s</p>
                              <span className={`text-xs px-2 py-1 rounded mt-2 inline-block ${d.isCleanAir ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                                {d.isCleanAir ? 'Aire Limpio' : 'Aire Sucio/DRS'}
                              </span>
                            </div>
                          );
                        }
                        return null;
                      }} />
                      <Scatter name="Vueltas" data={laps}>
                        {laps.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.isCleanAir ? '#22c55e' : '#ef4444'} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Estadísticas de Filtrado
                </h4>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-green-900/20 rounded-lg border border-green-800">
                    <span className="text-green-400">Aire Limpio</span>
                    <span className="text-white font-mono text-xl">{cleanAirStats.cleanCount}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-red-900/20 rounded-lg border border-red-800">
                    <span className="text-red-400">Aire Sucio</span>
                    <span className="text-white font-mono text-xl">{cleanAirStats.dirtyCount}</span>
                  </div>
                  <div className="border-t border-gray-700 pt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Media Aire Limpio</span>
                      <span className="text-green-400 font-mono">{cleanAirStats.cleanAvg.toFixed(3)} s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Media Aire Sucio</span>
                      <span className="text-red-400 font-mono">{cleanAirStats.dirtyAvg.toFixed(3)} s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Delta estimado</span>
                      <span className="text-white font-mono">+{Math.abs(cleanAirStats.dirtyAvg - cleanAirStats.cleanAvg).toFixed(3)} s</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── DEGRADATION ── */}
      {activeProcess === 'degradation' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-orange-500" />
              Curvas de Degradación por Compuesto
            </h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={degradationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="tireAge" stroke="#6b7280" label={{ value: 'Edad del Neumático (vueltas)', position: 'bottom', fill: '#6b7280' }} />
                  <YAxis stroke="#6b7280" tickFormatter={v => (v as number).toFixed(1)} label={{ value: 'Pérdida de Ritmo (s)', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }} labelStyle={{ color: '#9ca3af' }} labelFormatter={label => `Vuelta ${label}`} />
                  <Legend />
                  <Line type="monotone" dataKey="soft" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} name="Soft (C3)" />
                  <Line type="monotone" dataKey="medium" stroke="#eab308" strokeWidth={2} dot={{ r: 3 }} name="Medium (C2)" />
                  <Line type="monotone" dataKey="hard" stroke="#f3f4f6" strokeWidth={2} dot={{ r: 3 }} name="Hard (C1)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([
              { name: 'Soft (C3)', key: 'Soft', bg: 'bg-red-900/20', border: 'border-red-700', textColor: 'text-red-400' },
              { name: 'Medium (C2)', key: 'Medium', bg: 'bg-yellow-900/20', border: 'border-yellow-700', textColor: 'text-yellow-400' },
              { name: 'Hard (C1)', key: 'Hard', bg: 'bg-gray-900/40', border: 'border-gray-600', textColor: 'text-gray-300' },
            ] as const).map(c => {
              const s = compoundStats[c.key];
              return (
                <div key={c.name} className={`${c.bg} border ${c.border} rounded-xl p-5`}>
                  <div className="text-white font-semibold mb-3">{c.name}</div>
                  {s ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Vueltas analizadas</span>
                        <span className="text-white font-mono">{s.laps}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Ventana óptima</span>
                        <span className="text-white font-mono">
                          {s.windowStart === s.windowEnd ? `vuelta ${s.windowStart}` : `${s.windowStart}-${s.windowEnd} vueltas`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Degradación</span>
                        <span className={`${c.textColor} font-mono`}>
                          {s.slope >= 0 ? '+' : ''}{s.slope.toFixed(3)} s/v
                          <span className="text-gray-500 text-xs ml-1">(≈{s.degOver30 >= 0 ? '+' : ''}{s.degOver30.toFixed(2)} s/30 v)</span>
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Mejor vuelta</span>
                        <span className="text-white font-mono">{s.bestLap.toFixed(3)} s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Pico de caída</span>
                        <span className={`${c.textColor} font-mono`}>+{s.peakLoss.toFixed(3)} s</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">Datos insuficientes (&lt; 3 vueltas en este compuesto)</p>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default TelemetryProcessing;
