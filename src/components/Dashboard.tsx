import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { filterDatasetByActiveSessions } from '../lib/activeDataset';
import {
  Activity,
  GitCompare,
  Gauge,
  Disc,
  Zap,
  Timer,
  Navigation,
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
  ReferenceArea,
  Legend,
  Area,
  AreaChart,
  ReferenceLine
} from 'recharts';
import { motion } from 'framer-motion';

const Dashboard: React.FC = () => {
  const { downloaded, catalogue, hasData, activeSessionKeys } = useData();
  // Apply the global "active sessions" filter; the rest of the component pretends only those
  // sessions exist.
  const downloadedData = useMemo(() => ({
    ...downloaded,
    telemetry: filterDatasetByActiveSessions(downloaded.telemetry, activeSessionKeys),
    laps: filterDatasetByActiveSessions(downloaded.laps, activeSessionKeys),
    sessions: downloaded.sessions.filter(s => activeSessionKeys.size === 0 || activeSessionKeys.has(`${s.year}_${s.round}_${s.sessionType}`))
  }), [downloaded, activeSessionKeys]);
  const resolvedDownloadDrivers = downloaded.drivers;
  const resolvedDownloadSessions = downloadedData.sessions;
  const availableCircuits = catalogue?.circuits ?? [];

  // Build list of drivers and sessions that actually have data
  const activeDrivers = useMemo(() => {
    if (!hasData) return [];
    const ids = new Set(Object.keys(downloadedData.telemetry).map(k => k.split('_')[0]));
    return resolvedDownloadDrivers.filter(d => ids.has(d.id));
  }, [hasData, downloadedData, resolvedDownloadDrivers]);

  const activeSessions = useMemo(() => {
    if (!hasData) return [];
    const sessionKeys = new Set(
      Object.keys(downloadedData.telemetry).map(k => k.split('_').slice(1).join('_'))
    );
    return resolvedDownloadSessions.filter(s => sessionKeys.has(`${s.year}_${s.round}_${s.sessionType}`));
  }, [hasData, downloadedData, resolvedDownloadSessions]);

  const [driver1Id, setDriver1Id] = useState<string>('');
  const [driver2Id, setDriver2Id] = useState<string>('');
  const [sessionKey, setSessionKey] = useState<string>('');
  const [metric, setMetric] = useState<'speed' | 'throttle' | 'brake' | 'rpm'>('speed');
  const [showDelta, setShowDelta] = useState(true);

  const d1 = activeDrivers.find(d => d.id === driver1Id) || activeDrivers[0];
  const d2 = activeDrivers.find(d => d.id === driver2Id) || activeDrivers[1] || activeDrivers[0];
  const session = activeSessions.find(s => `${s.year}_${s.round}_${s.sessionType}` === sessionKey) || activeSessions[0];

  const circuitForSession = useMemo(() => {
    if (!session) return null;
    return availableCircuits.find(c => c.id === session.circuit) || null;
  }, [session, availableCircuits]);

  const makeKey = (driverId: string) =>
    session ? `${driverId}_${session.year}_${session.round}_${session.sessionType}` : null;

  const telemetry1 = useMemo(() => {
    const key = d1 ? makeKey(d1.id) : null;
    return key ? (downloadedData.telemetry[key] || []) : [];
  }, [d1, session, downloadedData]);

  const telemetry2 = useMemo(() => {
    const key = d2 ? makeKey(d2.id) : null;
    return key ? (downloadedData.telemetry[key] || []) : [];
  }, [d2, session, downloadedData]);

  const getValue = (point: (typeof telemetry1)[0]) => {
    if (metric === 'speed') return point.speed;
    if (metric === 'throttle') return point.throttle * 100;
    if (metric === 'brake') return point.brake * 100;
    return point.rpm;
  };

  const comparisonData = useMemo(() => {
    if (telemetry1.length === 0) return [];
    const t2 = telemetry2.slice().sort((a, b) => a.distance - b.distance);
    const t2Dist = t2.map(p => p.distance);
    function nearestT2Value(dist: number): number {
      if (t2.length === 0) return 0;
      let lo = 0, hi = t2.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (t2Dist[mid] < dist) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && Math.abs(t2Dist[lo - 1] - dist) < Math.abs(t2Dist[lo] - dist)) lo--;
      return getValue(t2[lo]);
    }
    return telemetry1.map(point => {
      const v1 = getValue(point);
      const v2 = nearestT2Value(point.distance);
      return { distance: point.distance, driver1: v1, driver2: v2, delta: v1 - v2 };
    });
  }, [telemetry1, telemetry2, metric]);

  const brakeZones = useMemo(() => {
    const zones: { start: number; end: number }[] = [];
    let inZone = false;
    let start = 0;
    telemetry1.forEach(p => {
      if (p.brake > 0.1 && !inZone) { inZone = true; start = p.distance; }
      else if (p.brake <= 0.1 && inZone) { inZone = false; zones.push({ start, end: p.distance }); }
    });
    return zones.slice(0, 8);
  }, [telemetry1]);

  const metricConfig = {
    speed: { label: 'Velocidad', unit: 'km/h', domain: [0, 360] as [number, number] },
    throttle: { label: 'Acelerador', unit: '%', domain: [0, 100] as [number, number] },
    brake: { label: 'Freno', unit: '%', domain: [0, 100] as [number, number] },
    rpm: { label: 'RPM', unit: 'rpm', domain: [0, 16000] as [number, number] }
  };
  const config = metricConfig[metric];

  if (!hasData) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-500" />
            Dashboard de Telemetría Superpuesta
          </h2>
          <p className="text-gray-400 text-sm mt-1">Comparación espacialmente alineada (Distance-based)</p>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold text-lg mb-2">Datos no descargados</h3>
          <p className="text-gray-400">
            Ve al módulo <strong className="text-yellow-400">FastF1 Loader</strong> y descarga los datos primero.
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
            <Activity className="w-6 h-6 text-blue-500" />
            Dashboard de Telemetría Superpuesta
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Distance-based — {Object.keys(downloadedData.telemetry).length} datasets descargados
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {/* Piloto 1 */}
          <div>
            <label className="block text-gray-400 text-xs mb-2">Piloto 1</label>
            <select
              value={d1?.id || ''}
              onChange={e => setDriver1Id(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {activeDrivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          {/* Piloto 2 */}
          <div>
            <label className="block text-gray-400 text-xs mb-2">Piloto 2</label>
            <select
              value={d2?.id || ''}
              onChange={e => setDriver2Id(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              {activeDrivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          {/* Sesión */}
          <div>
            <label className="block text-gray-400 text-xs mb-2">Sesión</label>
            <select
              value={session ? `${session.year}_${session.round}_${session.sessionType}` : ''}
              onChange={e => setSessionKey(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {activeSessions.map(s => (
                <option key={`${s.year}_${s.round}_${s.sessionType}`} value={`${s.year}_${s.round}_${s.sessionType}`}>
                  {s.year} R{s.round} {s.sessionType} — {s.circuit}
                </option>
              ))}
            </select>
          </div>
          {/* Métrica */}
          <div>
            <label className="block text-gray-400 text-xs mb-2">Métrica</label>
            <div className="flex gap-1">
              {(['speed', 'throttle', 'brake', 'rpm'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  title={metricConfig[m].label}
                  className={`flex-1 py-2 rounded text-xs font-medium transition-all ${metric === m ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'}`}
                >
                  {m === 'speed' && <Gauge className="w-4 h-4 mx-auto" />}
                  {m === 'throttle' && <Zap className="w-4 h-4 mx-auto" />}
                  {m === 'brake' && <Disc className="w-4 h-4 mx-auto" />}
                  {m === 'rpm' && <Timer className="w-4 h-4 mx-auto" />}
                </button>
              ))}
            </div>
          </div>
          {/* Delta toggle */}
          <div>
            <label className="block text-gray-400 text-xs mb-2">Opciones</label>
            <button
              onClick={() => setShowDelta(!showDelta)}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${showDelta ? 'bg-green-600 text-white' : 'bg-gray-900 text-gray-400'}`}
            >
              <GitCompare className="w-4 h-4" />
              Mostrar Delta
            </button>
          </div>
        </div>

        {/* Circuit info */}
        {circuitForSession && (
          <div className="mt-3 pt-3 border-t border-gray-700 flex flex-wrap gap-4 text-xs text-gray-400">
            <span>🏁 {circuitForSession.name}</span>
            <span>📏 {circuitForSession.length.toLocaleString()} m</span>
            <span>🔀 {circuitForSession.corners.length} curvas</span>
            <span>🌡 {circuitForSession.weather.trackTemp}°C pista / {circuitForSession.weather.ambientTemp}°C ambiente</span>
          </div>
        )}
      </div>

      {/* Main chart */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            Comparación Espacial — {config.label}
          </h3>
          <div className="flex items-center gap-4 text-sm">
            {d1 && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d1.color }} />
                <span className="text-gray-400">{d1.name}</span>
              </div>
            )}
            {d2 && d2.id !== d1?.id && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d2.color }} />
                <span className="text-gray-400">{d2.name}</span>
              </div>
            )}
          </div>
        </div>

        {comparisonData.length === 0 ? (
          <p className="text-gray-500 text-center py-20">Sin telemetría para los pilotos/sesión seleccionados</p>
        ) : (
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="distance" stroke="#6b7280" tickFormatter={v => `${Math.round(v as number)}m`} label={{ value: 'Distancia (m)', position: 'bottom', fill: '#6b7280' }} />
                <YAxis stroke="#6b7280" domain={config.domain} tickFormatter={v => metric === 'rpm' ? `${Math.round((v as number) / 1000)}k` : String(Math.round(v as number))} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }}
                  labelStyle={{ color: '#9ca3af' }}
                  labelFormatter={label => `Dist: ${Math.round(label as number)} m`}
                />
                <Legend />
                {brakeZones.map((z, i) => (
                  <ReferenceArea key={i} x1={z.start} x2={z.end} fill="#dc2626" fillOpacity={0.1} />
                ))}
                {d1 && (
                  <Line type="monotone" dataKey="driver1" stroke={d1.color} strokeWidth={2} dot={false} name={d1.name} />
                )}
                {d2 && d2.id !== d1?.id && (
                  <Line type="monotone" dataKey="driver2" stroke={d2.color} strokeWidth={2} dot={false} name={d2.name} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="flex items-center justify-center gap-6 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-600/20 border border-red-600/30 rounded" />
            <span className="text-gray-400">Zonas de Frenada</span>
          </div>
        </div>
      </motion.div>

      {/* Delta chart */}
      {showDelta && comparisonData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-green-500" />
            Delta — {config.label} ({d1?.name} vs {d2?.name})
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="distance" stroke="#6b7280" tickFormatter={v => `${Math.round(v as number)}m`} />
                <YAxis stroke="#6b7280" tickFormatter={v => `${(v as number) > 0 ? '+' : ''}${Math.round(v as number)}`} />
                <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }} labelStyle={{ color: '#9ca3af' }} labelFormatter={label => `Dist: ${Math.round(label as number)} m`} />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="delta" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} name={`Delta ${config.unit}`} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-gray-500 text-sm mt-3 text-center">
            Positivo → ventaja {d1?.name} · Negativo → ventaja {d2?.name}
          </p>
        </motion.div>
      )}

      {/* Stats */}
      {comparisonData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: `Máx ${d1?.name || 'D1'}`, value: Math.max(...comparisonData.map(d => d.driver1)) },
            { label: `Máx ${d2?.name || 'D2'}`, value: Math.max(...comparisonData.map(d => d.driver2)) },
            { label: `Media ${d1?.name || 'D1'}`, value: comparisonData.reduce((a, b) => a + b.driver1, 0) / comparisonData.length },
            { label: `Media ${d2?.name || 'D2'}`, value: comparisonData.reduce((a, b) => a + b.driver2, 0) / comparisonData.length },
          ].map(stat => (
            <div key={stat.label} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="text-gray-400 text-sm mb-1">{stat.label}</div>
              <div className="text-2xl font-bold text-white">
                {metric === 'rpm' ? `${Math.round(stat.value / 1000)}k` : Math.round(stat.value)} {config.unit}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
