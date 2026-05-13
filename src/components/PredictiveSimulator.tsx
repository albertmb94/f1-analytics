import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import type { Circuit, Driver, SimulationResult, Team } from '../types/f1';
import {
  aggregateTeamMetrics,
  computePaceMaps,
  computeTeamIdealRanking,
  computeDriverIdealMap,
  computeIdealVariance,
  quantile,
  type TeamMetrics,
  type TeamIdealEntry,
  type SessionTypeLite
} from '../lib/teamMetrics';
import { filterDatasetByActiveSessions } from '../lib/activeDataset';
import {
  Calculator,
  Trophy,
  Target,
  TrendingUp,
  Wind,
  CloudRain,
  Sun,
  AlertTriangle,
  Play
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
  Legend,
  LabelList
} from 'recharts';
import { motion } from 'framer-motion';

const PredictiveSimulator: React.FC = () => {
  const { catalogue, selection, downloaded: downloadedRaw, activeSessionKeys } = useData();
  // Honor the global active-sessions filter so the simulator only consumes data the user wants.
  const downloaded = useMemo(() => ({
    ...downloadedRaw,
    telemetry: filterDatasetByActiveSessions(downloadedRaw.telemetry, activeSessionKeys),
    laps: filterDatasetByActiveSessions(downloadedRaw.laps, activeSessionKeys),
    sessions: downloadedRaw.sessions.filter(s => activeSessionKeys.size === 0 || activeSessionKeys.has(`${s.year}_${s.round}_${s.sessionType}`))
  }), [downloadedRaw, activeSessionKeys]);
  const availableCircuits = catalogue?.circuits ?? [];
  const availableTeams = catalogue?.teams
    ? Object.values(catalogue.teams).flat().filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
    : [];
  const selectedData = { circuits: selection.circuits, events: selection.events, drivers: downloaded.drivers, teams: downloaded.teams, years: selection.years };
  const [selectedCircuit, setSelectedCircuit] = useState('');
  const [weatherFactor, setWeatherFactor] = useState(1);
  const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([]);
  const [hasSimulated, setHasSimulated] = useState(false);

  // Aggregate per-driver telemetry+laps from real downloaded data, grouped by team.
  // Skips drivers with no telemetry at all (failed downloads).
  const realTeamData = useMemo(() => {
    const lapEntries = Object.entries(downloaded.laps ?? {});
    const telemetryEntries = downloaded.telemetry ?? {};
    if (lapEntries.length === 0 && Object.keys(telemetryEntries).length === 0) return null;

    const driversByTeam = new Map<string, Array<{ driverId: string; telemetry: typeof telemetryEntries[string]; laps: typeof lapEntries[number][1] }>>();
    const driverEntries: Array<{ driverId: string; team: string; laps: typeof lapEntries[number][1] }> = [];

    downloaded.drivers.forEach(driver => {
      const lapsForDriver = lapEntries
        .filter(([key]) => key.startsWith(`${driver.id}_`))
        .flatMap(([, laps]) => laps);
      const telemetryForDriver = Object.entries(telemetryEntries)
        .filter(([key]) => key.startsWith(`${driver.id}_`))
        .flatMap(([, points]) => points);
      if (lapsForDriver.length === 0 && telemetryForDriver.length === 0) return;
      const arr = driversByTeam.get(driver.team) ?? [];
      arr.push({ driverId: driver.id, telemetry: telemetryForDriver, laps: lapsForDriver });
      driversByTeam.set(driver.team, arr);
      driverEntries.push({ driverId: driver.id, team: driver.team, laps: lapsForDriver });
    });

    if (driversByTeam.size === 0) return null;

    const aggregateInputs = Array.from(driversByTeam.entries()).map(([team, drivers]) => ({
      team,
      drivers
    }));
    const characteristics = aggregateTeamMetrics(aggregateInputs);
    const { pace, driverPace } = computePaceMaps(driverEntries);
    const idealList = computeTeamIdealRanking(driverEntries);
    const idealRanking = new Map<string, TeamIdealEntry>();
    idealList.forEach(e => idealRanking.set(e.team, e));
    const driverIdeal = computeDriverIdealMap(driverEntries);

    // Per-team aggregated laps for variance estimation
    const teamLaps = new Map<string, typeof lapEntries[number][1]>();
    driverEntries.forEach(d => {
      const arr = teamLaps.get(d.team) ?? [];
      arr.push(...d.laps);
      teamLaps.set(d.team, arr);
    });

    // Track which teams have only some of their expected drivers loaded
    const expectedByTeam = new Map<string, number>();
    downloaded.drivers.forEach(d => {
      expectedByTeam.set(d.team, (expectedByTeam.get(d.team) ?? 0) + 1);
    });
    const partial = new Map<string, { loaded: number; expected: number }>();
    driversByTeam.forEach((loaded, team) => {
      const expected = expectedByTeam.get(team) ?? loaded.length;
      if (loaded.length < expected) partial.set(team, { loaded: loaded.length, expected });
    });

    return { characteristics, pace, driverPace, idealRanking, driverIdeal, teamLaps, partial };
  }, [downloaded.laps, downloaded.telemetry, downloaded.drivers]);

  const realTeamPace = realTeamData?.pace ?? null;
  const realCharacteristics = realTeamData?.characteristics ?? null;
  const realIdealRanking = realTeamData?.idealRanking ?? null;
  const realDriverIdeal = realTeamData?.driverIdeal ?? null;
  const realTeamLaps = realTeamData?.teamLaps ?? null;
  const partialTeams = realTeamData?.partial ?? null;

  const circuitOptions = useMemo(() => {
    if (selectedData.circuits.length > 0) return selectedData.circuits;

    const eventCircuitIds = [...new Set(selectedData.events.map(event => event.circuit))];
    const eventCircuits = availableCircuits.filter(circuit => eventCircuitIds.includes(circuit.id));
    return eventCircuits.length > 0 ? eventCircuits : availableCircuits;
  }, [availableCircuits, selectedData.circuits, selectedData.events]);

  const teamOptions = useMemo(() => {
    if (selectedData.teams.length > 0) return selectedData.teams;

    const driverTeams = [...new Set(selectedData.drivers.map(driver => driver.team))];
    const inferredTeams = availableTeams.filter(team => driverTeams.includes(team.name));
    return inferredTeams.length > 0 ? inferredTeams : availableTeams;
  }, [availableTeams, selectedData.drivers, selectedData.teams]);

  const driverOptions = useMemo(() => selectedData.drivers, [selectedData.drivers]);
  const circuit = circuitOptions.find(c => c.id === selectedCircuit) || circuitOptions[0];

  useEffect(() => {
    if (!selectedCircuit && circuitOptions.length > 0) {
      setSelectedCircuit(circuitOptions[0].id);
      return;
    }

    if (selectedCircuit && circuitOptions.length > 0 && !circuitOptions.some(c => c.id === selectedCircuit)) {
      setSelectedCircuit(circuitOptions[0].id);
      setHasSimulated(false);
    }
  }, [circuitOptions, selectedCircuit]);

  const calculateTopologyMismatch = (chars: TeamMetrics, selectedTrack: Circuit) => {
    const downforcePenalty = Math.abs(chars.downforce - selectedTrack.profile.downforceReq) / 100;
    const topSpeedPenalty = Math.abs((100 - chars.drag) - selectedTrack.profile.topSpeedImportance) / 100;
    const tirePenalty = Math.max(0, selectedTrack.profile.tireWear - chars.tireManagement) / 100;
    const brakingPenalty = Math.max(0, selectedTrack.profile.brakingEnergy - chars.traction) / 120;
    return (downforcePenalty * 0.35 + topSpeedPenalty * 0.3 + tirePenalty * 0.2 + brakingPenalty * 0.15) * 1.8;
  };

  // Teams that lack real telemetry are excluded from the simulator: we don't synthesize a basePace.
  const eligibleTeams = useMemo(() => {
    if (!realIdealRanking) return [] as Team[];
    return teamOptions.filter(t => realIdealRanking.has(t.name));
  }, [teamOptions, realIdealRanking]);

  const excludedTeams = useMemo(
    () => teamOptions.filter(t => !eligibleTeams.includes(t)),
    [teamOptions, eligibleTeams]
  );

  // Pick the best session for the selected circuit; prefer Q (closer to the simulator's intent)
  const activeSessionType: SessionTypeLite = useMemo(() => {
    if (!circuit) return 'Q';
    const sessions = downloaded.sessions.filter(s => s.circuit === circuit.id);
    const q = sessions.find(s => s.sessionType === 'Q');
    const sq = sessions.find(s => s.sessionType === 'SQ');
    const r = sessions.find(s => s.sessionType === 'R' || s.sessionType === 'S');
    return (q?.sessionType ?? sq?.sessionType ?? r?.sessionType ?? sessions[0]?.sessionType ?? 'Q') as SessionTypeLite;
  }, [circuit, downloaded.sessions]);

  const runMonteCarlo = (selectedTrack: Circuit, teamsToSimulate: Team[], driversToSimulate: Driver[]): SimulationResult[] => {
    if (!realIdealRanking || !realCharacteristics || !realTeamLaps || teamsToSimulate.length === 0) return [];
    const simulations = 10000;
    const isRace = activeSessionType === 'R' || activeSessionType === 'S';
    const topologyFactor = isRace ? 1.0 : 0.3; // Q ideals already encode circuit affinity

    const entries = teamsToSimulate
      .map(team => {
        const idealEntry = realIdealRanking.get(team.name);
        if (!idealEntry) return null;
        const chars = realCharacteristics.get(team.name) ?? { traction: 50, downforce: 50, drag: 50, tireManagement: 50 };
        const teamDrivers = driversToSimulate.filter(driver => driver.team === team.name);
        // Driver adjustment: each driver's ideal lap minus team's best ideal lap.
        // The team-best driver yields adjustment 0; slower team-mates push the average upward.
        const teamIdeal = idealEntry.idealLap;
        const adjustments = teamDrivers
          .map(d => realDriverIdeal?.get(d.id))
          .filter((v): v is number => typeof v === 'number')
          .map(v => v - teamIdeal);
        const adjustment = adjustments.length > 0
          ? adjustments.reduce((s, v) => s + v, 0) / adjustments.length
          : 0;
        const teamLaps = realTeamLaps.get(team.name) ?? [];
        const variance = computeIdealVariance(teamLaps, activeSessionType);
        return { team, effectivePace: teamIdeal, variance, chars, driverAdjustment: adjustment };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (entries.length === 0) return [];

    const paceSamples = entries.map(({ team, effectivePace, variance, chars, driverAdjustment: adjustment }) => {
      const topologyPenalty = calculateTopologyMismatch(chars, selectedTrack) * topologyFactor;
      const samples = Array.from({ length: simulations }, () => {
        // Box-Muller-ish: average two uniforms to approximate normal-like noise scaled by variance.
        const noise = ((Math.random() + Math.random() + Math.random() + Math.random()) / 4 - 0.5) * 2;
        const stochastic = noise * variance * weatherFactor;
        return effectivePace + topologyPenalty + adjustment + stochastic;
      });
      return { team, samples };
    });

    // Pole threshold: 5th percentile of all samples across all teams (the "fastest" 5%).
    const allSamples = paceSamples.flatMap(p => p.samples);
    const poleThreshold = quantile(allSamples, 0.05);

    const results = paceSamples
      .map(({ team, samples }, index) => {
        let wins = 0;
        let poles = 0;
        for (let i = 0; i < simulations; i++) {
          let bestIdx = 0;
          let bestPace = paceSamples[0].samples[i];
          for (let j = 1; j < paceSamples.length; j++) {
            const p = paceSamples[j].samples[i];
            if (p < bestPace) { bestPace = p; bestIdx = j; }
          }
          if (bestIdx === index) {
            wins += 1;
            if (samples[i] < poleThreshold) poles += 1;
          }
        }

        return {
          team: team.name,
          winProbability: (wins / simulations) * 100,
          poleProbability: (poles / simulations) * 100,
          expectedPace: samples.reduce((sum, sample) => sum + sample, 0) / simulations
        } satisfies SimulationResult;
      })
      .sort((a, b) => b.winProbability - a.winProbability);

    const sumWin = results.reduce((s, r) => s + r.winProbability, 0);
    if (Math.abs(sumWin - 100) > 1) {
      console.warn(`Monte Carlo: win probabilities sum to ${sumWin.toFixed(2)}% (expected ≈ 100)`);
    }
    // Sanity check: top-3 of Monte Carlo should match top-3 of ideal-lap ranking
    const idealOrder = Array.from(realIdealRanking.values())
      .sort((a, b) => a.idealLap - b.idealLap)
      .slice(0, 3)
      .map(e => e.team);
    const mcOrder = results.slice(0, 3).map(r => r.team);
    const matches = mcOrder.filter(t => idealOrder.includes(t)).length;
    if (matches < 2) {
      console.warn('Monte Carlo top-3 diverges from ideal-lap ranking', { mcOrder, idealOrder });
    }
    return results;
  };

  const runSimulation = () => {
    if (!circuit || eligibleTeams.length === 0) return;
    const results = runMonteCarlo(circuit, eligibleTeams, driverOptions);
    setSimulationResults(results);
    setHasSimulated(true);
  };

  const teamColorByName = useMemo(() => {
    const map = new Map<string, string>();
    downloaded.drivers.forEach(d => {
      if (!map.has(d.team)) map.set(d.team, d.color);
    });
    return map;
  }, [downloaded.drivers]);

  const chartData = useMemo(() => {
    return simulationResults.map(r => ({
      team: r.team,
      winProb: r.winProbability,
      poleProb: r.poleProbability,
      pace: r.expectedPace,
      fullTeam: r.team,
      shortTeam: r.team.split(' ').slice(0, 2).join(' '),
      color: teamColorByName.get(r.team) ?? '#a855f7'
    }));
  }, [simulationResults, teamColorByName]);

  // Delta vs fastest car, ordered ascending. Used by the "Diferencia Esperada" chart.
  const deltaChartData = useMemo(() => {
    if (simulationResults.length === 0) return [];
    const fastestPace = Math.min(...simulationResults.map(r => r.expectedPace));
    return simulationResults
      .map(r => ({
        team: r.team,
        delta: r.expectedPace - fastestPace,
        fullTeam: r.team,
        shortTeam: r.team.split(' ').slice(0, 2).join(' '),
        color: teamColorByName.get(r.team) ?? '#a855f7'
      }))
      .sort((a, b) => a.delta - b.delta);
  }, [simulationResults, teamColorByName]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calculator className="w-6 h-6 text-green-500" />
            Simulador Predictivo (Monte Carlo)
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Simulación de 10,000 escenarios reactiva a la selección del FastF1 Loader
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Circuit Selection */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Circuito</label>
            <select 
              value={selectedCircuit}
              onChange={(e) => {
                setSelectedCircuit(e.target.value);
                setHasSimulated(false);
              }}
              className="w-full bg-gray-900 border border-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {circuitOptions.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              {selectedData.circuits.length > 0
                ? `${selectedData.circuits.length} circuitos marcados en Loader`
                : selectedData.events.length > 0
                  ? `${circuitOptions.length} circuitos derivados de eventos seleccionados`
                  : `${circuitOptions.length} circuitos disponibles por temporada`}
            </p>
          </div>

          {/* Weather Factor */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Condiciones Meteorológicas</label>
            <div className="flex gap-2">
              <button
                onClick={() => { setWeatherFactor(1); setHasSimulated(false); }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all ${
                  weatherFactor === 1 ? 'bg-green-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'
                }`}
              >
                <Sun className="w-4 h-4" />
                Seco
              </button>
              <button
                onClick={() => { setWeatherFactor(1.3); setHasSimulated(false); }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all ${
                  weatherFactor === 1.3 ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'
                }`}
              >
                <CloudRain className="w-4 h-4" />
                Lluvia
              </button>
              <button
                onClick={() => { setWeatherFactor(1.5); setHasSimulated(false); }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all ${
                  weatherFactor === 1.5 ? 'bg-purple-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'
                }`}
              >
                <Wind className="w-4 h-4" />
                Mixto
              </button>
            </div>
          </div>

          {/* Run Button */}
          <div className="flex items-end">
            <button
              onClick={runSimulation}
              disabled={!circuit || eligibleTeams.length === 0}
              className={`w-full flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-medium transition-all ${
                !circuit || eligibleTeams.length === 0
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              <Play className="w-4 h-4" />
              Ejecutar Simulación (10,000 runs)
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-700 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-xs mb-1">Equipos elegibles</div>
            <div className="text-white font-bold">{eligibleTeams.length} <span className="text-gray-500 text-sm font-normal">/ {teamOptions.length}</span></div>
            <div className="text-gray-500 text-xs mt-1">
              {realTeamPace ? 'Con telemetría real cargada' : 'Sin datos descargados'}
            </div>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-xs mb-1">Pilotos seleccionados</div>
            <div className="text-white font-bold">{driverOptions.length}</div>
            <div className="text-gray-500 text-xs mt-1">Ajustan el pace esperado del equipo</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="text-gray-400 text-xs mb-1">Temporadas activas</div>
            <div className="text-white font-bold">{selectedData.years.join(', ') || 'Ninguna'}</div>
            <div className="text-gray-500 text-xs mt-1">Origen: FastF1 Loader</div>
          </div>
        </div>

        {/* Circuit Profile Summary */}
        {circuit && <div className="mt-6 pt-6 border-t border-gray-700 grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center">
            <div className="text-gray-400 text-xs mb-1">Downforce Req</div>
            <div className="text-white font-bold">{circuit.profile.downforceReq}%</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-xs mb-1">Braking Energy</div>
            <div className="text-white font-bold">{circuit.profile.brakingEnergy}%</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-xs mb-1">Tire Wear</div>
            <div className="text-white font-bold">{circuit.profile.tireWear}%</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-xs mb-1">Top Speed</div>
            <div className="text-white font-bold">{circuit.profile.topSpeedImportance}%</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-xs mb-1">Lateral G</div>
            <div className="text-white font-bold">{circuit.profile.lateralG}%</div>
          </div>
        </div>}
      </div>

      {teamOptions.length === 0 && (
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-4 text-yellow-200">
          Selecciona al menos una temporada, equipo o piloto en FastF1 Loader para habilitar la simulación.
        </div>
      )}

      {realTeamPace && realTeamPace.size > 0 && (
        <div className="bg-green-900/20 border border-green-700 rounded-xl p-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
          <span className="text-green-300 text-sm">
            Ritmo y características derivados de telemetría real OpenF1 ({realTeamPace.size} equipos con datos).
          </span>
        </div>
      )}
      {!realTeamPace && downloaded.lastUpdate && (
        <div className="bg-amber-900/20 border border-amber-700 rounded-xl p-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
          <span className="text-amber-300 text-sm">
            Sin vueltas limpias descargadas todavía. Descarga al menos una sesión con telemetría desde el Loader.
          </span>
        </div>
      )}
      {!downloaded.lastUpdate && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-gray-500 flex-shrink-0" />
          <span className="text-gray-300 text-sm">
            Aún no se ha descargado telemetría. Conecta y descarga sesiones desde el FastF1 Loader.
          </span>
        </div>
      )}
      {excludedTeams.length > 0 && downloaded.lastUpdate && (
        <div className="bg-red-900/20 border border-red-800/60 rounded-xl p-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-300 text-sm font-medium mb-1">
              Equipos excluidos por falta de datos reales ({excludedTeams.length})
            </p>
            <p className="text-gray-400 text-xs">
              {excludedTeams.map(t => t.name).join(', ')}. Sin vueltas limpias para estos equipos no se puede simular sin sesgar el resultado.
            </p>
          </div>
        </div>
      )}
      {partialTeams && partialTeams.size > 0 && downloaded.lastUpdate && (
        <div className="bg-amber-900/20 border border-amber-800/60 rounded-xl p-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 text-sm font-medium mb-1">
              Equipos con datos parciales ({partialTeams.size})
            </p>
            <p className="text-gray-400 text-xs">
              {Array.from(partialTeams.entries()).map(([team, info]) => `${team} (${info.loaded}/${info.expected} pilotos)`).join(', ')}.
              El cálculo aún funciona porque usa la vuelta ideal del piloto disponible, pero la varianza puede ser menor de lo real.
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {hasSimulated && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Win Probability Chart */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Probabilidad de Victoria
            </h3>
            <div style={{ height: Math.max(220, chartData.length * 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                  <XAxis type="number" stroke="#6b7280" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="team" hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Probabilidad']}
                  />
                  <Bar dataKey="winProb" name="Win Probability" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                    <LabelList
                      dataKey="fullTeam"
                      position="insideLeft"
                      offset={10}
                      fill="#ffffff"
                      style={{ fontSize: 12, fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
                    />
                    <LabelList
                      dataKey="winProb"
                      position="right"
                      offset={8}
                      fill="#e5e7eb"
                      formatter={(v) => `${Number(v).toFixed(1)}%`}
                      style={{ fontSize: 12, fontFamily: 'monospace' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pole vs Win Comparison */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-500" />
                Pole vs Victoria
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="team" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" tickFormatter={(v) => `${v}%`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }}
                      labelStyle={{ color: '#9ca3af' }}
                    />
                    <Legend />
                    <Bar dataKey="poleProb" name="Pole Probability" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="winProb" name="Win Probability" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Expected Pace */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-500" />
                Diferencia Esperada (s)
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deltaChartData} margin={{ top: 24, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="shortTeam" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#6b7280" domain={[0, 'dataMax + 0.3']} tickFormatter={v => `+${(v as number).toFixed(2)}s`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151' }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(value) => [Number(value) === 0 ? 'Más rápido' : `+${Number(value).toFixed(3)} s`, 'Δ vs líder']}
                    />
                    <Bar dataKey="delta" name="Diferencia vs líder" radius={[4, 4, 0, 0]}>
                      {deltaChartData.map((entry, index) => (
                        <Cell key={`delta-cell-${index}`} fill={entry.color} />
                      ))}
                      <LabelList
                        dataKey="delta"
                        position="top"
                        formatter={(v) => Number(v) === 0 ? 'Más rápido' : `+${Number(v).toFixed(3)}s`}
                        fill="#9ca3af"
                        style={{ fontSize: 10, fontFamily: 'monospace' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Detailed Results Table */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">Resultados Detallados</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left text-gray-400 font-medium py-3">Pos</th>
                    <th className="text-left text-gray-400 font-medium py-3">Equipo</th>
                    <th className="text-right text-gray-400 font-medium py-3">Win Prob</th>
                    <th className="text-right text-gray-400 font-medium py-3">Pole Prob</th>
                    <th className="text-right text-gray-400 font-medium py-3">Ritmo Esperado</th>
                    <th className="text-center text-gray-400 font-medium py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {simulationResults.map((result, index) => (
                    <tr key={result.team} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-3 text-gray-400 font-mono">{index + 1}</td>
                      <td className="py-3 text-white font-medium">{result.team}</td>
                      <td className="py-3 text-right">
                        <span className={`font-mono ${index === 0 ? 'text-green-400' : 'text-white'}`}>
                          {result.winProbability.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-blue-400 font-mono">{result.poleProbability.toFixed(1)}%</span>
                      </td>
                      <td className="py-3 text-right text-white font-mono">{result.expectedPace.toFixed(3)}s</td>
                      <td className="py-3 text-center">
                        {index === 0 && <span className="text-xs px-2 py-1 bg-green-900/50 text-green-400 rounded border border-green-700">Favorito</span>}
                        {index === 1 && <span className="text-xs px-2 py-1 bg-blue-900/50 text-blue-400 rounded border border-blue-700">Contender</span>}
                        {index > 1 && <span className="text-xs px-2 py-1 bg-gray-700 text-gray-400 rounded">Outsider</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monte Carlo Explanation */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Metodología Monte Carlo
            </h4>
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-gray-400">
              <p className="text-green-400"># Algoritmo de simulación</p>
              <p>for i in range(10000):</p>
              <p className="pl-4">pace = team.base_pace + random.gauss(0, team.variance * weather_factor)</p>
              <p className="pl-4">pace += topology_mismatch(team, circuit_profile)</p>
              <p className="pl-4">if pace &lt; threshold: wins += 1</p>
              <br/>
              <p>win_probability = (wins / 10000) * 100</p>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="p-3 bg-gray-900 rounded-lg">
                <span className="text-green-400">Factor Clima:</span>
                <span className="text-gray-400 ml-2">{weatherFactor === 1 ? '1.0x (Seco)' : weatherFactor === 1.3 ? '1.3x (Lluvia)' : '1.5x (Mixto)'}</span>
              </div>
              <div className="p-3 bg-gray-900 rounded-lg">
                <span className="text-green-400">Simulaciones:</span>
                <span className="text-gray-400 ml-2">10,000 runs</span>
              </div>
              <div className="p-3 bg-gray-900 rounded-lg">
                <span className="text-green-400">Confianza:</span>
                <span className="text-gray-400 ml-2">95% (±2.5%)</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {!hasSimulated && (
        <div className="bg-gray-800/50 rounded-xl p-12 border border-gray-700 border-dashed text-center">
          <Calculator className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-400 mb-2">Simulación Pendiente</h3>
          <p className="text-gray-500">Configura los parámetros y ejecuta la simulación para ver resultados</p>
        </div>
      )}
    </div>
  );
};

export default PredictiveSimulator;
