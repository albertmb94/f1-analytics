import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import type { Circuit } from '../types/f1';
import { computeTireManagement, isCleanLap, aggregateTeamMetrics, type TeamMetrics } from '../lib/teamMetrics';
import { filterDatasetByActiveSessions, filterDriversByActiveSessions } from '../lib/activeDataset';
import { useTeamData } from '../hooks/useTeamData';
import { 
  MapPin, 
  Wind, 
  Thermometer, 
  Droplets, 
  Activity,
  Gauge,
  AlertTriangle,
  Grip,
  ArrowRight
} from 'lucide-react';
import { 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  Radar, 
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  Cell
} from 'recharts';
import { motion } from 'framer-motion';

const CircuitMapping: React.FC = () => {
  const { catalogue, selection, downloaded: downloadedRaw, activeSessionKeys } = useData();
  const downloaded = useMemo(() => ({
    ...downloadedRaw,
    telemetry: filterDatasetByActiveSessions(downloadedRaw.telemetry, activeSessionKeys),
    laps: filterDatasetByActiveSessions(downloadedRaw.laps, activeSessionKeys),
    drivers: filterDriversByActiveSessions(downloadedRaw.drivers, downloadedRaw.laps, activeSessionKeys),
    sessions: downloadedRaw.sessions.filter(s => activeSessionKeys.size === 0 || activeSessionKeys.has(`${s.year}_${s.round}_${s.sessionType}`))
  }), [downloadedRaw, activeSessionKeys]);
  const availableCircuits = (catalogue?.circuits ?? []).filter(c =>
    selection.circuits.length > 0 ? selection.circuits.some(sel => sel.id === c.id) : true
  );
  const [selectedCircuit, setSelectedCircuit] = useState<Circuit | null>(availableCircuits[0] || null);
  const [activeTab, setActiveTab] = useState<'overview' | 'corners' | 'pirelli'>('overview');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareTeam, setCompareTeam] = useState<string>('');
  const [compareDriver, setCompareDriver] = useState<string>('');

  const { characteristics, teamKeys } = useTeamData(
    downloaded.drivers, downloaded.laps, downloaded.telemetry
  );

  // Build team metrics for the comparison silhouette from the shared hook.
  // When a specific driver is picked, recompute using just that driver as if
  // they were a one-man "team" but normalize within the existing set so the
  // scale stays comparable.
  const carComparison = useMemo(() => {
    if (teamKeys.length === 0) return { teamMetrics: null as TeamMetrics | null, available: false };

    if (!compareEnabled || !compareTeam) return { teamMetrics: null, available: true };

    if (compareDriver) {
      const lapEntries = Object.entries(downloaded.laps ?? {});
      const telemetryEntries = downloaded.telemetry ?? {};
      const drivers = downloaded.drivers;

      const overrideByTeam = new Map<string, Array<{ driverId: string; telemetry: typeof telemetryEntries[string]; laps: typeof lapEntries[number][1] }>>();
      drivers.forEach(driver => {
        const lapsForDriver = Object.entries(downloaded.laps ?? {})
          .filter(([key]) => key.startsWith(`${driver.id}_`))
          .flatMap(([, l]) => l);
        const telForDriver = Object.entries(downloaded.telemetry ?? {})
          .filter(([key]) => key.startsWith(`${driver.id}_`))
          .flatMap(([, t]) => t);
        if (lapsForDriver.length === 0 && telForDriver.length === 0) return;
        const arr = overrideByTeam.get(driver.team) ?? [];
        arr.push({ driverId: driver.id, telemetry: telForDriver, laps: lapsForDriver });
        overrideByTeam.set(driver.team, arr);
      });

      const overrideInputs = Array.from(overrideByTeam.entries()).map(([team, ds]) => ({ team, drivers: ds }));
      const driver = drivers.find(d => d.id === compareDriver);
      if (!driver) return { teamMetrics: characteristics.get(compareTeam) ?? null, available: true };
      const justThisDriver = (overrideByTeam.get(driver.team) ?? []).filter(d => d.driverId === compareDriver);
      if (justThisDriver.length === 0) return { teamMetrics: characteristics.get(compareTeam) ?? null, available: true };
      const inputsWithDriverOverride = overrideInputs.map(t => t.team === driver.team ? { ...t, drivers: justThisDriver } : t);
      const overrideMetrics = aggregateTeamMetrics(inputsWithDriverOverride);
      return { teamMetrics: overrideMetrics.get(driver.team) ?? null, available: true };
    }

    return { teamMetrics: characteristics.get(compareTeam) ?? null, available: true };
  }, [characteristics, teamKeys, compareEnabled, compareTeam, compareDriver, downloaded]);

  const teamsWithData = teamKeys;

  const driversInSelectedTeam = useMemo(() => {
    if (!compareTeam) return [];
    return downloaded.drivers.filter(d => d.team === compareTeam);
  }, [downloaded.drivers, compareTeam]);

  // Real weather and degradation derived from downloaded sessions for this circuit
  const realCircuitData = useMemo(() => {
    if (!selectedCircuit) return null;
    const sessionKeysForCircuit = downloaded.sessions
      .filter(s => s.circuit === selectedCircuit.id)
      .map(s => `${s.year}_${s.round}_${s.sessionType}`);
    if (sessionKeysForCircuit.length === 0) return null;

    const weatherSamples = sessionKeysForCircuit
      .map(k => downloaded.weather[k])
      .filter((w): w is NonNullable<typeof w> => Boolean(w));

    const lapsForCircuit = Object.entries(downloaded.laps)
      .filter(([key]) => sessionKeysForCircuit.some(s => key.endsWith('_' + s)))
      .flatMap(([, laps]) => laps);

    let topSpeed = 0;
    Object.entries(downloaded.telemetry).forEach(([key, points]) => {
      if (sessionKeysForCircuit.some(s => key.endsWith('_' + s))) {
        for (const p of points) if (p.speed > topSpeed) topSpeed = p.speed;
      }
    });

    const cleanCount = lapsForCircuit.filter(isCleanLap).length;
    // Tire degradation slope (s lost per lap of tire age). Higher = more wear.
    const tireMgmt = computeTireManagement(lapsForCircuit);
    // Convert: tireMgmt is -slope (positive = good). We want a 0-100 wear score where higher = more wear.
    // A typical degradation is 0.02..0.10 s/lap. Map -tireMgmt to 0-100.
    const wearRaw = Math.max(0, -tireMgmt);
    const tireWearReal = Math.min(100, Math.round(wearRaw * 1000));

    if (weatherSamples.length === 0 && lapsForCircuit.length === 0) return null;

    let weather: { trackTemp: number; ambientTemp: number; humidity: number; rainProbability: number; sampleCount: number; sources: number } | null = null;
    if (weatherSamples.length > 0) {
      const avg = (sel: (w: typeof weatherSamples[number]) => number) =>
        weatherSamples.reduce((s, w) => s + sel(w), 0) / weatherSamples.length;
      weather = {
        trackTemp: Math.round(avg(w => w.trackTemp) * 10) / 10,
        ambientTemp: Math.round(avg(w => w.ambientTemp) * 10) / 10,
        humidity: Math.round(avg(w => w.humidity)),
        rainProbability: avg(w => w.rainfallProbability),
        sampleCount: weatherSamples.reduce((s, w) => s + w.sampleCount, 0),
        sources: weatherSamples.length
      };
    }

    return {
      weather,
      tireWearReal: lapsForCircuit.length >= 5 ? tireWearReal : null,
      cleanLapCount: cleanCount,
      topSpeed: topSpeed > 0 ? Math.round(topSpeed) : null,
      sessionsAnalyzed: sessionKeysForCircuit.length
    };
  }, [selectedCircuit, downloaded.sessions, downloaded.weather, downloaded.laps, downloaded.telemetry]);

  // Update selected circuit when available circuits change
  React.useEffect(() => {
    if (availableCircuits.length > 0 && (!selectedCircuit || !availableCircuits.some(c => c.id === selectedCircuit.id))) {
      setSelectedCircuit(availableCircuits[0]);
    }
  }, [availableCircuits, selectedCircuit]);

  if (!selectedCircuit) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Selecciona al menos una temporada en FastF1 Loader para ver los circuitos
      </div>
    );
  }

  // Radar chart data. `circuit` = profile requirements of the track; `car` = comparison silhouette
  // derived from the selected team/driver's real telemetry. Mapping:
  //   Downforce → downforce skill
  //   Braking → traction (proxy of pickup/braking capability)
  //   Tire Wear → tireManagement
  //   Top Speed → 100 - drag (less drag = higher top speed)
  //   Lateral G → average of downforce + traction
  const radarData = useMemo(() => {
    const cm = carComparison.teamMetrics;
    const carDown = cm?.downforce ?? 0;
    const carTrac = cm?.traction ?? 0;
    return [
      { subject: 'Downforce', circuit: selectedCircuit.profile.downforceReq, car: carDown, fullMark: 100 },
      { subject: 'Braking', circuit: selectedCircuit.profile.brakingEnergy, car: carTrac, fullMark: 100 },
      { subject: 'Tire Wear', circuit: selectedCircuit.profile.tireWear, car: cm?.tireManagement ?? 0, fullMark: 100 },
      { subject: 'Top Speed', circuit: selectedCircuit.profile.topSpeedImportance, car: 100 - (cm?.drag ?? 50), fullMark: 100 },
      { subject: 'Lateral G', circuit: selectedCircuit.profile.lateralG, car: (carDown + carTrac) / 2, fullMark: 100 },
    ];
  }, [selectedCircuit, carComparison]);

  const compareLabel = useMemo(() => {
    if (!compareTeam) return '';
    if (compareDriver) {
      const d = downloaded.drivers.find(x => x.id === compareDriver);
      return d?.name ?? compareTeam;
    }
    return compareTeam;
  }, [compareTeam, compareDriver, downloaded.drivers]);

  // Corner classification colors
  const getCornerColor = (cornerClass: string) => {
    switch (cornerClass) {
      case 'Low': return '#ef4444';
      case 'Medium': return '#f59e0b';
      case 'High': return '#22c55e';
      default: return '#6b7280';
    }
  };

  // Apex speed distribution data
  const apexData = useMemo(() => {
    return selectedCircuit.corners.map(c => ({
      name: c.name,
      speed: c.apexSpeed,
      angle: c.angle,
      class: c.class,
      x: c.x,
      y: c.y
    }));
  }, [selectedCircuit]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <MapPin className="w-6 h-6 text-red-500" />
            Mapeo Topológico Automatizado
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Ingesta geométrica desde FastF1 + clasificación dinámica de curvas
          </p>
        </div>
        <select
          aria-label="Seleccionar circuito"
          value={selectedCircuit.id}
          onChange={(e) => setSelectedCircuit(availableCircuits.find(c => c.id === e.target.value) || availableCircuits[0])}
          className="bg-gray-800 border border-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          {availableCircuits.map((c: Circuit) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-gray-800 p-1 rounded-lg w-fit">
        {(['overview', 'corners', 'pirelli'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab 
                ? 'bg-red-600 text-white' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {tab === 'overview' && 'Perfil del Circuito'}
            {tab === 'corners' && 'Análisis de Curvas'}
            {tab === 'pirelli' && 'Datos Pirelli'}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'overview' && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
          {/* Radar Chart */}
          <div className="lg:col-span-2 bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-red-500" />
                Perfil Técnico del Circuito
              </h3>
              {selectedCircuit.profileSource === 'curated' ? (
                <span className="text-xs px-2 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700">
                  Datos curados
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700">
                  Estimación geométrica
                </span>
              )}
            </div>
            {/* Compare car vs circuit controls */}
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-gray-700">
              <button
                onClick={() => setCompareEnabled(v => !v)}
                disabled={!carComparison.available}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  !carComparison.available
                    ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                    : compareEnabled
                      ? 'bg-blue-600 text-white shadow-blue-500/20 shadow-lg'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title={!carComparison.available ? 'Descarga al menos una sesión para comparar' : ''}
              >
                <span className={`w-2 h-2 rounded-full ${compareEnabled ? 'bg-white' : 'bg-gray-500'}`} />
                Comparar coche vs circuito
              </button>
              <select
                aria-label="Seleccionar equipo para comparar"
                value={compareTeam}
                onChange={e => { setCompareTeam(e.target.value); setCompareDriver(''); }}
                disabled={!compareEnabled || !carComparison.available}
                className={`bg-gray-900 border border-gray-700 text-white px-3 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-opacity ${(!compareEnabled || !carComparison.available) ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <option value="">Equipo…</option>
                {teamsWithData.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                aria-label="Seleccionar piloto para comparar"
                value={compareDriver}
                onChange={e => setCompareDriver(e.target.value)}
                disabled={!compareEnabled || !compareTeam || !carComparison.available}
                className={`bg-gray-900 border border-gray-700 text-white px-3 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-opacity ${(!compareEnabled || !compareTeam || !carComparison.available) ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <option value="">Piloto (opcional)…</option>
                {driversInSelectedTeam.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar
                    name={selectedCircuit.name}
                    dataKey="circuit"
                    stroke="#dc2626"
                    strokeWidth={2}
                    fill="#dc2626"
                    fillOpacity={0.3}
                  />
                  {compareEnabled && carComparison.teamMetrics && (
                    <Radar
                      name={compareLabel || 'Comparativa'}
                      dataKey="car"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="#3b82f6"
                      fillOpacity={0.25}
                    />
                  )}
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={(value, name) => [`${Number(value).toFixed(0)}%`, name]}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {compareEnabled && !carComparison.teamMetrics && carComparison.available && (
              <p className="text-amber-400 text-xs mt-2">Selecciona un equipo para mostrar la silueta comparativa.</p>
            )}
          </div>

          {/* Circuit Stats */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Especificaciones</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Longitud</span>
                  <span className="text-white font-mono">{selectedCircuit.length.toLocaleString()} m</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Número de Curvas</span>
                  <span className="text-white font-mono">{selectedCircuit.corners.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Curvas Bajas</span>
                  <span className="text-red-400 font-mono">
                    {selectedCircuit.corners.filter(c => c.class === 'Low').length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Curvas Medias</span>
                  <span className="text-amber-400 font-mono">
                    {selectedCircuit.corners.filter(c => c.class === 'Medium').length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Curvas Altas</span>
                  <span className="text-green-400 font-mono">
                    {selectedCircuit.corners.filter(c => c.class === 'High').length}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                <Wind className="w-5 h-5 text-blue-400" />
                Condiciones Meteorológicas
              </h3>
              {realCircuitData?.weather ? (
                <p className="text-green-400 text-xs mb-3">
                  Real · {realCircuitData.weather.sources} sesión{realCircuitData.weather.sources !== 1 ? 'es' : ''} · {realCircuitData.weather.sampleCount} muestras OpenF1
                </p>
              ) : (
                <p className="text-amber-400 text-xs mb-3">
                  Estimación heurística por país (descarga sesiones para ver datos reales)
                </p>
              )}
              {(() => {
                const w = realCircuitData?.weather ?? {
                  trackTemp: selectedCircuit.weather.trackTemp,
                  ambientTemp: selectedCircuit.weather.ambientTemp,
                  humidity: selectedCircuit.weather.humidity,
                  rainProbability: selectedCircuit.weather.rainProbability
                };
                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-2">
                        <Thermometer className="w-4 h-4" />
                        Temp. Pista
                      </span>
                      <span className="text-white font-mono">{w.trackTemp}°C</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-2">
                        <Thermometer className="w-4 h-4" />
                        Temp. Ambiente
                      </span>
                      <span className="text-white font-mono">{w.ambientTemp}°C</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-2">
                        <Droplets className="w-4 h-4" />
                        Humedad
                      </span>
                      <span className="text-white font-mono">{w.humidity}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        {realCircuitData?.weather ? 'Lluvia (en sesión)' : 'Prob. Lluvia (estimada)'}
                      </span>
                      <span className={`font-mono ${w.rainProbability > 0.3 ? 'text-red-400' : 'text-green-400'}`}>
                        {(w.rainProbability * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'corners' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          {selectedCircuit.corners.length === 0 && (
            <div className="col-span-2 bg-gray-800 rounded-xl p-12 border border-gray-700 border-dashed text-center">
              <MapPin className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 font-medium">Geometría de curvas no disponible</p>
              <p className="text-gray-500 text-sm mt-2">
                Este circuito no tiene datos de corners en la fuente OpenF1.
                El perfil del circuito y los datos Pirelli sí están disponibles.
              </p>
            </div>
          )}
          {selectedCircuit.corners.length > 0 && <>
          {/* Corner Map */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-red-500" />
              Mapa de Curvas (XY Coordinates)
            </h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <XAxis type="number" dataKey="x" name="X" hide />
                  <YAxis type="number" dataKey="y" name="Y" hide />
                  <ZAxis type="number" dataKey="speed" range={[100, 400]} />
                  <Tooltip 
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-lg">
                            <p className="text-white font-semibold">Curva {data.name}</p>
                            <p className="text-gray-400 text-sm">Apex Speed: {data.speed} km/h</p>
                            <p className="text-gray-400 text-sm">Ángulo: {data.angle}°</p>
                            <span className={`text-xs px-2 py-1 rounded mt-2 inline-block ${
                              data.class === 'Low' ? 'bg-red-900 text-red-300' :
                              data.class === 'Medium' ? 'bg-amber-900 text-amber-300' :
                              'bg-green-900 text-green-300'
                            }`}>
                              {data.class} Speed
                            </span>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter name="Corners" data={apexData} fill="#8884d8">
                    {apexData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getCornerColor(entry.class)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-gray-400 text-sm">Baja (&lt;100 km/h)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span className="text-gray-400 text-sm">Media (100-160 km/h)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-gray-400 text-sm">Alta (&gt;160 km/h)</span>
              </div>
            </div>
          </div>

          {/* Corner Table */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 overflow-hidden">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Gauge className="w-5 h-5 text-red-500" />
              Clasificación por Apex Speed
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left text-gray-400 font-medium py-2">Curva</th>
                    <th className="text-left text-gray-400 font-medium py-2">Distancia</th>
                    <th className="text-left text-gray-400 font-medium py-2">Ángulo</th>
                    <th className="text-left text-gray-400 font-medium py-2">Apex Speed</th>
                    <th className="text-left text-gray-400 font-medium py-2">Clase</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCircuit.corners.map((corner) => (
                    <tr key={corner.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-3 text-white font-medium">{corner.name}</td>
                      <td className="py-3 text-gray-400">{corner.distance}m</td>
                      <td className="py-3 text-gray-400">{corner.angle}°</td>
                      <td className="py-3 text-white font-mono">{corner.apexSpeed} km/h</td>
                      <td className="py-3">
                        <span className={`text-xs px-2 py-1 rounded font-medium ${
                          corner.class === 'Low' ? 'bg-red-900/50 text-red-400 border border-red-700' :
                          corner.class === 'Medium' ? 'bg-amber-900/50 text-amber-400 border border-amber-700' :
                          'bg-green-900/50 text-green-400 border border-green-700'
                        }`}>
                          {corner.class.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>}
        </motion.div>
      )}

      {activeTab === 'pirelli' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gray-800 rounded-xl p-6 border border-gray-700"
        >
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Grip className="w-5 h-5 text-yellow-500" />
            Datos Oficiales Pirelli
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Abrasion */}
            <div className="bg-gray-900 rounded-lg p-5 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-400">Abrasión del Asfalto</span>
                <AlertTriangle className="w-5 h-5 text-orange-500" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-white">{selectedCircuit.pirelliData.abrasion}</span>
                <span className="text-gray-500 mb-1">/5</span>
              </div>
              <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-orange-500 rounded-full"
                  style={{ width: `${(selectedCircuit.pirelliData.abrasion / 5) * 100}%` }}
                />
              </div>
              <p className="text-gray-500 text-sm mt-2">
                {selectedCircuit.pirelliData.abrasion >= 4 ? 'Alto desgaste de neumáticos' :
                 selectedCircuit.pirelliData.abrasion >= 3 ? 'Desgaste moderado' : 'Bajo desgaste'}
              </p>
            </div>

            {/* Grip */}
            <div className="bg-gray-900 rounded-lg p-5 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-400">Nivel de Agarre</span>
                <Grip className="w-5 h-5 text-green-500" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-white">{selectedCircuit.pirelliData.grip}</span>
                <span className="text-gray-500 mb-1">/5</span>
              </div>
              <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${(selectedCircuit.pirelliData.grip / 5) * 100}%` }}
                />
              </div>
              <p className="text-gray-500 text-sm mt-2">
                {selectedCircuit.pirelliData.grip >= 4 ? 'Alto agarre mecánico' :
                 selectedCircuit.pirelliData.grip >= 3 ? 'Agarre medio' : 'Bajo agarre'}
              </p>
            </div>

            {/* Lateral Stress */}
            <div className="bg-gray-900 rounded-lg p-5 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-400">Estrés Lateral</span>
                <ArrowRight className="w-5 h-5 text-blue-500" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-white">{selectedCircuit.pirelliData.lateralStress}</span>
                <span className="text-gray-500 mb-1">/5</span>
              </div>
              <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${(selectedCircuit.pirelliData.lateralStress / 5) * 100}%` }}
                />
              </div>
              <p className="text-gray-500 text-sm mt-2">
                {selectedCircuit.pirelliData.lateralStress >= 4 ? 'Alto estrés en curvas' :
                 selectedCircuit.pirelliData.lateralStress >= 3 ? 'Estrés moderado' : 'Bajo estrés lateral'}
              </p>
            </div>

            {/* Longitudinal Stress */}
            <div className="bg-gray-900 rounded-lg p-5 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-400">Estrés Longitudinal</span>
                <Activity className="w-5 h-5 text-purple-500" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-white">{selectedCircuit.pirelliData.longitudinalStress}</span>
                <span className="text-gray-500 mb-1">/5</span>
              </div>
              <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 rounded-full"
                  style={{ width: `${(selectedCircuit.pirelliData.longitudinalStress / 5) * 100}%` }}
                />
              </div>
              <p className="text-gray-500 text-sm mt-2">
                {selectedCircuit.pirelliData.longitudinalStress >= 4 ? 'Alto estrés en frenadas' :
                 selectedCircuit.pirelliData.longitudinalStress >= 3 ? 'Estrés moderado' : 'Bajo estrés'}
              </p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-amber-900/10 border border-amber-800/40 rounded-lg text-xs text-amber-200">
            Los valores Pirelli (1–5) son una clasificación heurística por tipo de circuito; OpenF1 no expone este dato.
            Las métricas reales derivadas de la telemetría descargada se muestran abajo.
          </div>

          {realCircuitData && (realCircuitData.tireWearReal !== null || realCircuitData.topSpeed !== null) && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-900 rounded-lg p-5 border border-green-700/40">
                <div className="text-xs text-green-400 mb-1">Telemetría real</div>
                <div className="text-gray-400 text-sm mb-1">Top speed observado</div>
                <div className="text-2xl text-white font-mono font-bold">
                  {realCircuitData.topSpeed ?? '—'} <span className="text-gray-500 text-sm">km/h</span>
                </div>
                <p className="text-gray-500 text-xs mt-1">{realCircuitData.sessionsAnalyzed} sesiones analizadas</p>
              </div>
              <div className="bg-gray-900 rounded-lg p-5 border border-green-700/40">
                <div className="text-xs text-green-400 mb-1">Telemetría real</div>
                <div className="text-gray-400 text-sm mb-1">Desgaste medido (slope)</div>
                <div className="text-2xl text-white font-mono font-bold">
                  {realCircuitData.tireWearReal !== null ? `${realCircuitData.tireWearReal}` : '—'}
                  <span className="text-gray-500 text-sm">/100</span>
                </div>
                <p className="text-gray-500 text-xs mt-1">
                  {realCircuitData.cleanLapCount} vueltas limpias usadas
                </p>
              </div>
              <div className="bg-gray-900 rounded-lg p-5 border border-gray-700">
                <div className="text-xs text-gray-500 mb-1">Derivado del trazado</div>
                <div className="text-gray-400 text-sm mb-1">Lateral G estimada</div>
                <div className="text-2xl text-white font-mono font-bold">
                  {selectedCircuit.profile.lateralG}<span className="text-gray-500 text-sm">/100</span>
                </div>
                <p className="text-gray-500 text-xs mt-1">Calculado desde el reparto de curvas</p>
              </div>
            </div>
          )}

          <div className="mt-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
            <h4 className="text-white font-semibold mb-2">Recomendación de Compuestos</h4>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-red-600"></div>
                <span className="text-gray-400 text-sm">C3 - Soft</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-yellow-500"></div>
                <span className="text-gray-400 text-sm">C2 - Medium</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-white"></div>
                <span className="text-gray-400 text-sm">C1 - Hard</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default CircuitMapping;
