import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import type { TelemetryPoint, Lap } from '../types/f1';
import { filterDatasetByActiveSessions, filterDriversByActiveSessions } from '../lib/activeDataset';
import { Table, Download, Search, AlertCircle, ChevronDown, ChevronRight, Activity, Timer } from 'lucide-react';

const RawData: React.FC = () => {
  const { downloaded: downloadedRaw, hasData, activeSessionKeys } = useData();
  const downloaded = useMemo(() => ({
    ...downloadedRaw,
    telemetry: filterDatasetByActiveSessions(downloadedRaw.telemetry, activeSessionKeys),
    laps: filterDatasetByActiveSessions(downloadedRaw.laps, activeSessionKeys),
    drivers: filterDriversByActiveSessions(downloadedRaw.drivers, downloadedRaw.laps, activeSessionKeys),
    sessions: downloadedRaw.sessions.filter(s => activeSessionKeys.size === 0 || activeSessionKeys.has(`${s.year}_${s.round}_${s.sessionType}`))
  }), [downloadedRaw, activeSessionKeys]);
  const [activeView, setActiveView] = useState<'telemetry' | 'laps'>('laps');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [lapPage, setLapPage] = useState(0);
  const ROWS_PER_PAGE = 50;

  // Parse dataset keys into readable labels
  const parseKey = (key: string) => {
    const parts = key.split('_');
    const driverId = parts[0];
    const year     = parts[1];
    const round    = parts[2];
    const session  = parts[3];
    const driver   = downloaded.drivers.find(d => d.id === driverId);
    return {
      driverId,
      driverName: driver?.name ?? driverId,
      team:       driver?.team ?? '—',
      color:      driver?.color ?? '#888',
      year, round, session,
      label: `${driver?.name ?? driverId} — ${year} R${round} ${session}`
    };
  };

  const allKeys = Object.keys(downloaded.telemetry).filter(k =>
    !searchTerm || parseKey(k).label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Currently selected dataset
  const selectedKey = expandedKey ?? allKeys[0] ?? null;
  const selectedMeta = selectedKey ? parseKey(selectedKey) : null;

  const telemetryData: TelemetryPoint[] = selectedKey ? (downloaded.telemetry[selectedKey] ?? []) : [];
  const lapData: Lap[]                  = selectedKey ? (downloaded.laps[selectedKey] ?? []) : [];

  const paginatedLaps = lapData.slice(lapPage * ROWS_PER_PAGE, (lapPage + 1) * ROWS_PER_PAGE);
  const paginatedTel  = telemetryData.slice(lapPage * ROWS_PER_PAGE, (lapPage + 1) * ROWS_PER_PAGE);

  // CSV export
  const exportCSV = () => {
    if (!selectedKey) return;
    let csv = '';
    if (activeView === 'laps') {
      const headers = ['lap', 'time', 'fuelCorrectedTime', 'tireCompound', 'tireAge', 'isCleanAir', 'gapToLeader'];
      csv = [headers.join(','), ...lapData.map(l => [l.number, l.time.toFixed(4), l.fuelCorrectedTime.toFixed(4), l.tireCompound, l.tireAge, l.isCleanAir, l.gapToLeader?.toFixed(3) ?? ''].join(','))].join('\n');
    } else {
      const headers = ['time', 'distance', 'x', 'y', 'speed', 'rpm', 'gear', 'throttle', 'brake', 'drs'];
      csv = [headers.join(','), ...telemetryData.map(t => [t.time.toFixed(1), t.distance.toFixed(1), t.x.toFixed(2), t.y.toFixed(2), t.speed.toFixed(1), t.rpm.toFixed(0), t.gear, t.throttle.toFixed(3), t.brake.toFixed(3), t.drs ? 1 : 0].join(','))].join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${selectedKey}_${activeView}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!hasData) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Table className="w-6 h-6 text-cyan-500" />
            Datos Brutos
          </h2>
          <p className="text-gray-400 text-sm mt-1">Inspección directa de telemetría y vueltas descargadas</p>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-10 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold text-lg mb-2">Sin datos descargados</h3>
          <p className="text-gray-400">Ve al <strong className="text-yellow-400">FastF1 Loader</strong>, selecciona temporadas + pilotos y descarga.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Table className="w-6 h-6 text-cyan-500" />
            Datos Brutos
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            {Object.keys(downloaded.telemetry).length} datasets · {downloaded.sessions.length} sesiones · {downloaded.drivers.length} pilotos
          </p>
        </div>
        <button
          onClick={exportCSV}
          disabled={!selectedKey}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* ── Dataset list (sidebar) ── */}
        <div className="xl:col-span-1 bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="p-3 border-b border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Filtrar datasets..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-gray-900 text-white text-sm pl-9 pr-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-700/50">
            {allKeys.length === 0 && (
              <p className="text-gray-500 text-sm p-4 text-center">Sin resultados</p>
            )}
            {allKeys.map(key => {
              const meta = parseKey(key);
              const isActive = key === selectedKey;
              return (
                <button
                  key={key}
                  onClick={() => { setExpandedKey(key); setLapPage(0); }}
                  className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors ${isActive ? 'bg-cyan-900/30 border-l-2 border-cyan-500' : 'hover:bg-gray-700/30'}`}
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                  <div className="min-w-0">
                    <div className="text-white text-xs font-medium truncate">{meta.driverName}</div>
                    <div className="text-gray-500 text-xs truncate">{meta.year} R{meta.round} {meta.session}</div>
                    <div className="text-gray-600 text-xs truncate">{meta.team}</div>
                  </div>
                  {isActive ? <ChevronDown className="w-3 h-3 text-cyan-400 ml-auto shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-600 ml-auto shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Data table ── */}
        <div className="xl:col-span-3 space-y-4">
          {/* Dataset info bar */}
          {selectedMeta && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedMeta.color }} />
                <span className="text-white font-semibold">{selectedMeta.driverName}</span>
                <span className="text-gray-400 text-sm">({selectedMeta.team})</span>
              </div>
              <span className="text-gray-400 text-sm">{selectedMeta.year} · Round {selectedMeta.round} · Session {selectedMeta.session}</span>
              <div className="flex items-center gap-3 ml-auto">
                <span className="text-gray-500 text-xs flex items-center gap-1"><Activity className="w-3 h-3" />{telemetryData.length} puntos</span>
                <span className="text-gray-500 text-xs flex items-center gap-1"><Timer className="w-3 h-3" />{lapData.length} vueltas</span>
              </div>
            </div>
          )}

          {/* View switcher */}
          <div className="flex gap-2 bg-gray-800 p-1 rounded-lg w-fit">
            {([
              { id: 'laps', label: 'Vueltas', count: lapData.length },
              { id: 'telemetry', label: 'Telemetría 2Hz', count: telemetryData.length },
            ] as const).map(({ id, label, count }) => (
              <button
                key={id}
                onClick={() => { setActiveView(id); setLapPage(0); }}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeView === id ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              >
                {label} <span className="text-xs opacity-70">({count})</span>
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              {activeView === 'laps' ? (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
                    <tr>
                      {['Vuelta', 'Tiempo (s)', 'Fuel Corr. (s)', 'Δ Combustible', 'Compuesto', 'Edad Neum.', 'Aire Limpio', 'Gap Líder (s)'].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {paginatedLaps.map((lap: Lap) => (
                      <tr key={lap.number} className="hover:bg-gray-700/20 transition-colors">
                        <td className="px-3 py-2 text-white font-mono font-bold">{lap.number}</td>
                        <td className="px-3 py-2 text-white font-mono">{lap.time.toFixed(3)}</td>
                        <td className="px-3 py-2 text-green-400 font-mono">{lap.fuelCorrectedTime.toFixed(3)}</td>
                        <td className="px-3 py-2 text-yellow-400 font-mono">-{((lap.time - lap.fuelCorrectedTime)).toFixed(3)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            lap.tireCompound === 'Soft' ? 'bg-red-900/50 text-red-300' :
                            lap.tireCompound === 'Medium' ? 'bg-yellow-900/50 text-yellow-300' :
                            'bg-gray-600 text-gray-200'
                          }`}>{lap.tireCompound}</span>
                        </td>
                        <td className="px-3 py-2 text-white font-mono">{lap.tireAge}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-medium ${lap.isCleanAir ? 'text-green-400' : 'text-red-400'}`}>
                            {lap.isCleanAir ? '✓ Limpio' : '✗ Sucio'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-300 font-mono">{lap.gapToLeader?.toFixed(3) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
                    <tr>
                      {['t (s)', 'Dist (m)', 'X', 'Y', 'Speed (km/h)', 'RPM', 'Gear', 'Throttle', 'Brake', 'DRS'].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {paginatedTel.map((pt: TelemetryPoint, idx: number) => (
                      <tr key={idx} className={`hover:bg-gray-700/20 transition-colors ${pt.brake > 0.1 ? 'bg-red-900/5' : ''}`}>
                        <td className="px-3 py-2 text-gray-400 font-mono">{pt.time.toFixed(1)}</td>
                        <td className="px-3 py-2 text-gray-300 font-mono">{pt.distance.toFixed(0)}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono">{pt.x.toFixed(1)}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono">{pt.y.toFixed(1)}</td>
                        <td className="px-3 py-2 text-white font-mono font-bold">{pt.speed.toFixed(1)}</td>
                        <td className="px-3 py-2 text-purple-300 font-mono">{pt.rpm.toFixed(0)}</td>
                        <td className="px-3 py-2 text-white font-mono">{pt.gear}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: `${pt.throttle * 100}%` }} />
                            </div>
                            <span className="text-green-400 font-mono text-xs">{(pt.throttle * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full bg-red-500 rounded-full" style={{ width: `${pt.brake * 100}%` }} />
                            </div>
                            <span className="text-red-400 font-mono text-xs">{(pt.brake * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-bold ${pt.drs ? 'text-cyan-400' : 'text-gray-600'}`}>{pt.drs ? 'ON' : 'OFF'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 text-sm text-gray-400">
              <span>
                Filas {lapPage * ROWS_PER_PAGE + 1}–{Math.min((lapPage + 1) * ROWS_PER_PAGE, activeView === 'laps' ? lapData.length : telemetryData.length)} de {activeView === 'laps' ? lapData.length : telemetryData.length}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLapPage(p => Math.max(0, p - 1))}
                  disabled={lapPage === 0}
                  className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => setLapPage(p => p + 1)}
                  disabled={(lapPage + 1) * ROWS_PER_PAGE >= (activeView === 'laps' ? lapData.length : telemetryData.length)}
                  className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RawData;
