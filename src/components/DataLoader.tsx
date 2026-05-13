import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import type { FastF1Event, FastF1Session, Driver, Team, Circuit } from '../context/DataContext';
import {
  Database, Download, Calendar, MapPin, Users, Trophy,
  Check, Filter, ChevronDown, ChevronRight, Loader2,
  AlertCircle, AlertTriangle, Search, Wifi, WifiOff, CheckSquare, Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Colour pill for session type
const SESSION_COLORS: Record<string, string> = {
  FP1: 'bg-gray-700 text-gray-300',
  FP2: 'bg-gray-700 text-gray-300',
  FP3: 'bg-gray-700 text-gray-300',
  Q:   'bg-blue-900/60 text-blue-300 border border-blue-700',
  SQ:  'bg-purple-900/60 text-purple-300 border border-purple-700',
  S:   'bg-purple-900/60 text-purple-300 border border-purple-700',
  R:   'bg-red-900/60 text-red-300 border border-red-700',
};

const DataLoader: React.FC = () => {
  const {
    apiStatus, apiError, connectingProgress, connectToFastF1,
    catalogue, failedCircuits,
    selection, toggleYear, toggleEvent, toggleEventSingleSession,
    toggleDriver, toggleTeam, toggleCircuit,
    selectAllForYear, clearSelection,
    canDownload, isDownloading, downloadProgress, downloadData,
    isRetrying, retryProgress, retryFailedDrivers,
    downloaded, hasData
  } = useData();

  const [expandedSections, setExpandedSections] = useState<string[]>(['years', 'events']);
  const [expandedEvents, setExpandedEvents]   = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm]           = useState('');
  const [showFilters, setShowFilters]         = useState(false);
  const [activeTab, setActiveTab]             = useState<'events' | 'drivers' | 'circuits'>('events');

  const toggleSection = (s: string) =>
    setExpandedSections(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const isExpanded = (s: string) => expandedSections.includes(s);

  const toggleEventExpand = (key: string) =>
    setExpandedEvents(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Helper checks
  const isYearSelected    = (y: number) => selection.years.includes(y);
  const isEventSelected   = (e: FastF1Event) => selection.events.some(x => x.year === e.year && x.round === e.round);
  const isSessionSelected = (s: FastF1Session) => selection.sessions.some(x => x.year === s.year && x.round === s.round && x.sessionType === s.sessionType);
  const isDriverSelected  = (d: Driver) => selection.drivers.some(x => x.id === d.id);
  const isTeamSelected    = (t: Team)   => selection.teams.some(x => x.id === t.id);
  const isCircuitSelected = (c: Circuit) => selection.circuits.some(x => x.id === c.id);

  // Catalogue filtered by search
  const allEvents = catalogue?.events ?? [];
  const filteredEvents = allEvents.filter(e =>
    !searchTerm ||
    e.eventName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.country.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group events by year
  const years = catalogue?.years ?? [];
  const eventsByYear = years.reduce<Record<number, FastF1Event[]>>((acc, y) => {
    acc[y] = filteredEvents.filter(e => e.year === y);
    return acc;
  }, {});

  // Drivers for the selected years, grouped by team
  const driversByTeam = selection.years.reduce<Record<string, Driver[]>>((acc, y) => {
    const yearDrivers = catalogue?.drivers[y] ?? [];
    yearDrivers.forEach(d => {
      if (!acc[d.team]) acc[d.team] = [];
      if (!acc[d.team].some(x => x.id === d.id)) acc[d.team].push(d);
    });
    return acc;
  }, {});

  const teamsForYear = selection.years.flatMap(y => catalogue?.teams[y] ?? [])
    .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i);

  const circuitsForYear = (catalogue?.circuits ?? []).filter(c =>
    selection.years.some(y =>
      (catalogue?.events.some(e => e.year === y && e.circuit === c.id)) ?? false
    )
  );

  // Stats
  const totalEstimatedDatasets = selection.sessions.length * selection.drivers.length;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Database className="w-6 h-6 text-blue-500" />
            FastF1 Data Loader
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Conecta · Selecciona · Descarga · Analiza
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* API status button */}
          <button
            onClick={apiStatus === 'idle' || apiStatus === 'error' ? connectToFastF1 : undefined}
            disabled={apiStatus === 'connecting'}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-all text-sm ${
              apiStatus === 'connected'  ? 'bg-green-900/40 border border-green-600 text-green-400 cursor-default' :
              apiStatus === 'connecting' ? 'bg-yellow-900/40 border border-yellow-600 text-yellow-400 cursor-wait' :
              apiStatus === 'error'      ? 'bg-red-900/40 border border-red-600 text-red-400 hover:bg-red-900/60' :
                                           'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {apiStatus === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> :
             apiStatus === 'connected'  ? <Wifi className="w-4 h-4" /> :
             apiStatus === 'error'      ? <WifiOff className="w-4 h-4" /> :
                                          <Database className="w-4 h-4" />}
            {apiStatus === 'connecting' ? 'Conectando...' :
             apiStatus === 'connected'  ? 'FastF1 Conectado' :
             apiStatus === 'error'      ? 'Error – Reintentar' :
                                          'Conectar FastF1 API'}
          </button>

          {hasData && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/30 border border-green-700 rounded-lg">
              <Check className="w-4 h-4 text-green-400" />
              <span className="text-green-400 text-sm font-medium">
                {Object.keys(downloaded.telemetry).length} datasets descargados
              </span>
            </div>
          )}

          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${showFilters ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            <Filter className="w-4 h-4" />
            Filtros
          </button>
        </div>
      </div>

      {/* ── Not connected yet ── */}
      {apiStatus === 'idle' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-10 text-center">
          <Database className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-white text-xl font-semibold mb-2">Conecta con FastF1 API</h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Pulsa <strong className="text-blue-400">Conectar FastF1 API</strong> para cargar el catálogo de temporadas, eventos, pilotos y circuitos disponibles.
          </p>
          <button
            onClick={connectToFastF1}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 mx-auto"
          >
            <Database className="w-5 h-5" />
            Conectar FastF1 API
          </button>
        </div>
      )}

      {apiStatus === 'connecting' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-10 text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-white font-semibold">Conectando con FastF1 API...</p>
          <p className="text-gray-400 text-sm mt-1">{connectingProgress || 'Iniciando conexión…'}</p>
          <p className="text-gray-600 text-xs mt-2">Las temporadas se cargan una a una para respetar el límite de la API</p>
        </div>
      )}

      {apiStatus === 'error' && (
        <div className="bg-red-900/20 border border-red-700 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-10 h-10 text-red-500 shrink-0 mt-1" />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-lg">Error de conexión</p>
              <p className="text-gray-400 text-sm mt-1">
                No se pudo conectar con la API de OpenF1. Asegúrate de que la aplicación corra desde
                un servidor web — abre una terminal en la carpeta del proyecto y ejecuta:
              </p>
              <code className="block mt-2 mb-3 px-3 py-2 bg-gray-900 rounded text-green-400 text-sm font-mono">
                npm run dev
              </code>
              {apiError && (
                <details className="mt-2">
                  <summary className="text-gray-500 text-xs cursor-pointer hover:text-gray-300">Detalles técnicos</summary>
                  <p className="mt-1 text-red-400 text-xs font-mono break-all">{apiError}</p>
                </details>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={connectToFastF1} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* ── Catalogue loaded ── */}
      {apiStatus === 'connected' && catalogue && (
        <>
          {/* Search bar */}
          {showFilters && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Buscar eventos, países, pilotos..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 text-white pl-10 pr-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button onClick={clearSelection} className="px-4 py-2 bg-red-900/30 border border-red-700 text-red-400 rounded-lg hover:bg-red-900/50 text-sm">
                Limpiar todo
              </button>
            </motion.div>
          )}

          {/* Selection summary pills */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: 'Años',      value: selection.years.length },
              { label: 'Eventos',   value: selection.events.length },
              { label: 'Sesiones',  value: selection.sessions.length },
              { label: 'Pilotos',   value: selection.drivers.length },
              { label: 'Equipos',   value: selection.teams.length },
              { label: 'Circuitos', value: selection.circuits.length },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800 rounded-lg px-3 py-2 border border-gray-700 text-center">
                <div className="text-gray-500 text-xs">{label}</div>
                <div className={`text-lg font-bold ${value > 0 ? 'text-white' : 'text-gray-600'}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── Years ── */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <button
              onClick={() => toggleSection('years')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-blue-500" />
                <span className="font-semibold text-white">Temporadas</span>
              </div>
              {isExpanded('years') ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
            </button>
            <AnimatePresence>
              {isExpanded('years') && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="border-t border-gray-700">
                  <div className="p-4 flex flex-wrap gap-3">
                    {years.map(year => (
                      <div key={year} className="flex items-center gap-2">
                        <button
                          onClick={() => toggleYear(year)}
                          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                            isYearSelected(year) ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'
                          }`}
                        >
                          {year}
                        </button>
                        {isYearSelected(year) && (
                          <button
                            onClick={() => selectAllForYear(year)}
                            className="px-3 py-2 rounded-lg text-xs bg-green-900/40 border border-green-700 text-green-400 hover:bg-green-900/60 transition-all whitespace-nowrap"
                          >
                            + Seleccionar toda la temporada
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Events · Drivers · Circuits tabs ── */}
          {selection.years.length > 0 && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              {/* Sub-tabs */}
              <div className="flex border-b border-gray-700">
                {([
                  { id: 'events',   label: 'Grandes Premios', icon: Trophy },
                  { id: 'drivers',  label: 'Pilotos / Equipos', icon: Users },
                  { id: 'circuits', label: 'Circuitos', icon: MapPin },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${
                      activeTab === id ? 'bg-gray-700 text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Events tab */}
              {activeTab === 'events' && (
                <div className="max-h-[32rem] overflow-y-auto divide-y divide-gray-700">
                  {selection.years.map(year => {
                    const yEvents = eventsByYear[year] ?? [];
                    if (yEvents.length === 0) return null;
                    const allSel = yEvents.every(e => isEventSelected(e));
                    return (
                      <div key={year}>
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-900 sticky top-0 z-10">
                          <span className="text-white font-bold text-sm">🏁 {year} — {yEvents.length} carreras</span>
                          <button
                            onClick={() => selectAllForYear(year)}
                            className={`text-xs px-3 py-1 rounded-lg transition-all ${
                              allSel ? 'bg-green-800 text-green-300' : 'bg-blue-900/40 border border-blue-700 text-blue-400 hover:bg-blue-900/60'
                            }`}
                          >
                            {allSel ? '✓ Temporada completa' : 'Seleccionar todo'}
                          </button>
                        </div>
                        {yEvents.map(event => {
                          const evKey = `${event.year}-${event.round}`;
                          const evSelected = isEventSelected(event);
                          const expanded = expandedEvents.has(evKey);
                          const isSprint = event.sessions.some(s => s.sessionType === 'S');
                          const unavailable = event.isCancelled || event.sessions.every(s => s.available === false || s.isCancelled);
                          return (
                            <div key={evKey} className="border-b border-gray-700/40">
                              <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors">
                                {/* Checkbox */}
                                <button onClick={() => !unavailable && toggleEvent(event)} disabled={unavailable}>
                                  {evSelected
                                    ? <CheckSquare className="w-5 h-5 text-blue-400" />
                                    : <Square className={`w-5 h-5 ${unavailable ? 'text-gray-800' : 'text-gray-600'}`} />}
                                </button>
                                {/* Event info */}
                                <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-white text-sm font-medium truncate">{event.eventName}</span>
                                  {isSprint && (
                                    <span className="text-xs px-1.5 py-0.5 bg-purple-900/60 text-purple-300 border border-purple-700 rounded">Sprint</span>
                                  )}
                                  {unavailable && (
                                    <span className="text-xs px-1.5 py-0.5 bg-red-900/60 text-red-300 border border-red-700 rounded">No disponible</span>
                                  )}
                                </div>
                                  <div className="text-gray-500 text-xs">{event.country} · {event.location} · R{event.round} · {event.sessions.length} sesiones</div>
                                </div>
                                {/* Expand sessions */}
                                <button
                                  onClick={() => toggleEventExpand(evKey)}
                                  className="text-gray-500 hover:text-white p-1"
                                >
                                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </button>
                              </div>

                              {/* Sessions grid */}
                              {expanded && (
                                <div className="px-12 pb-3 flex flex-wrap gap-2">
                                  {event.sessions.map(sess => {
                                    const selSess = isSessionSelected(sess);
                                    const available = sess.available !== false && !sess.isCancelled;
                                    return (
                                      <button
                                        key={sess.sessionType}
                                        disabled={!available}
                                        onClick={() => {
                                          if (!available) return;
                                          toggleEventSingleSession(event, sess);
                                        }}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                          !available
                                            ? 'bg-gray-900/60 text-gray-600 border border-gray-800 cursor-not-allowed'
                                            : selSess
                                              ? SESSION_COLORS[sess.sessionType] + ' opacity-100'
                                              : 'bg-gray-900 text-gray-400 hover:bg-gray-700'
                                        }`}
                                      >
                                        {sess.sessionType} {!available ? '✕' : selSess ? '✓' : ''}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Drivers tab */}
              {activeTab === 'drivers' && (
                <div className="max-h-[32rem] overflow-y-auto p-4 space-y-4">
                  {Object.entries(driversByTeam).map(([teamName, drivers]) => {
                    const team = teamsForYear.find(t => t.name === teamName);
                    const teamSel = team ? isTeamSelected(team) : false;
                    const allDriversSel = drivers.every(d => isDriverSelected(d));
                    return (
                      <div key={teamName} className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 bg-gray-850">
                          <div className="flex items-center gap-3">
                            {team && (
                              <button onClick={() => toggleTeam(team)}>
                                {teamSel
                                  ? <CheckSquare className="w-5 h-5 text-purple-400" />
                                  : <Square className="w-5 h-5 text-gray-600" />}
                              </button>
                            )}
                            <span className="text-white font-semibold text-sm">{teamName}</span>
                            {team && (
                              <span className="text-gray-500 text-xs font-mono">{team.basePace.toFixed(3)} s</span>
                            )}
                          </div>
                          {!allDriversSel && (
                            <button
                              onClick={() => drivers.forEach(d => { if (!isDriverSelected(d)) toggleDriver(d); })}
                              className="text-xs text-blue-400 hover:text-blue-300"
                            >
                              Sel. todos
                            </button>
                          )}
                        </div>
                        <div className="divide-y divide-gray-700">
                          {drivers.map(driver => (
                            <button
                              key={driver.id}
                              onClick={() => toggleDriver(driver)}
                              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700/40 transition-colors ${isDriverSelected(driver) ? 'bg-green-900/10' : ''}`}
                            >
                              {isDriverSelected(driver)
                                ? <CheckSquare className="w-5 h-5 text-green-400 shrink-0" />
                                : <Square className="w-5 h-5 text-gray-600 shrink-0" />}
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: driver.color }} />
                              <span className="text-white text-sm flex-1 text-left">{driver.name}</span>
                              <span className="text-gray-500 text-xs">#{driver.number}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Circuits tab */}
              {activeTab === 'circuits' && (
                <div className="max-h-[32rem] overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {circuitsForYear.filter(c =>
                    !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase())
                  ).map(circuit => {
                    const sel = isCircuitSelected(circuit);
                    return (
                      <button
                        key={circuit.id}
                        onClick={() => toggleCircuit(circuit)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          sel ? 'bg-red-900/20 border-red-700' : 'bg-gray-900 border-gray-700 hover:border-gray-600'
                        }`}
                      >
                        {sel ? <CheckSquare className="w-5 h-5 text-red-400 shrink-0" /> : <Square className="w-5 h-5 text-gray-600 shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-white text-sm font-medium truncate">{circuit.name}</div>
                          <div className="text-gray-500 text-xs">
                            {circuit.length.toLocaleString()} m · {circuit.corners.length} curvas
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Download panel ── */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            {canDownload && !isDownloading && (
              <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700 rounded-lg flex flex-wrap gap-4 text-sm">
                <span className="text-blue-400">
                  📡 <strong>{selection.sessions.length}</strong> sesiones seleccionadas
                </span>
                <span className="text-blue-400">
                  🏎 <strong>{selection.drivers.length}</strong> pilotos seleccionados
                </span>
                <span className="text-gray-400">
                  Total estimado: <strong className="text-white">{totalEstimatedDatasets}</strong> datasets
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Descargar Datos</h3>
                <p className="text-gray-400 text-sm">
                  {!canDownload && !isDownloading
                    ? 'Selecciona sesiones y pilotos para habilitar la descarga'
                    : isDownloading
                      ? downloadProgress.message
                      : `${selection.sessions.length} sesiones × ${selection.drivers.length} pilotos`}
                </p>
              </div>
              <button
                onClick={downloadData}
                disabled={!canDownload || isDownloading}
                className={`flex items-center gap-3 px-8 py-4 rounded-xl font-semibold transition-all shrink-0 ${
                  !canDownload || isDownloading
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20'
                }`}
              >
                {isDownloading
                  ? <><Loader2 className="w-5 h-5 animate-spin" /><span>{downloadProgress.current}/{downloadProgress.total}</span></>
                  : <><Download className="w-5 h-5" /><span>Iniciar Descarga FastF1</span></>}
              </button>
            </div>

            {isDownloading && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{downloadProgress.message}</span>
                  <span>{downloadProgress.total > 0 ? Math.round((downloadProgress.current / downloadProgress.total) * 100) : 0}%</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-blue-500"
                    animate={{ width: downloadProgress.total > 0 ? `${(downloadProgress.current / downloadProgress.total) * 100}%` : '0%' }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
              </div>
            )}

            {hasData && !isDownloading && (
              <div className="mt-4 pt-4 border-t border-gray-700 flex flex-wrap gap-4 text-sm">
                <span className="text-green-400 flex items-center gap-1"><Check className="w-4 h-4" /> Última descarga: {downloaded.lastUpdate?.toLocaleTimeString()}</span>
                <span className="text-gray-400">{Object.keys(downloaded.telemetry).length} datasets · {downloaded.sessions.length} sesiones · {downloaded.drivers.length} pilotos</span>
                {downloaded.failedDrivers.length > 0 && (
                  <span className="text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {downloaded.failedDrivers.length} fallos
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Telemetrías fallidas */}
          {hasData && !isDownloading && downloaded.failedDrivers.length > 0 && (
            <div className="bg-red-900/10 border border-red-800/60 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <h3 className="text-white font-semibold">
                    Telemetrías no descargadas ({downloaded.failedDrivers.length})
                  </h3>
                </div>
                {isRetrying ? (
                  <div className="flex-1 max-w-md">
                    <div className="flex justify-between text-xs text-amber-300 mb-1">
                      <span className="truncate">{retryProgress.message}</span>
                      <span>{retryProgress.total > 0 ? `${retryProgress.current}/${retryProgress.total}` : ''}</span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-200"
                        style={{ width: retryProgress.total > 0 ? `${(retryProgress.current / retryProgress.total) * 100}%` : '0%' }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={retryFailedDrivers}
                    disabled={isDownloading || isRetrying}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 border border-amber-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Loader2 className="w-4 h-4" />
                    Reintentar ({downloaded.failedDrivers.length})
                  </button>
                )}
              </div>
              <p className="text-gray-400 text-sm mb-3">
                OpenF1 no devolvió datos para los siguientes pilotos/sesiones. No se inyectan datos sintéticos: estos pilotos quedan marcados como "Sin datos" en los paneles y se excluyen del simulador.
              </p>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-xs uppercase border-b border-gray-700">
                    <tr>
                      <th className="text-left py-2 px-3">Piloto</th>
                      <th className="text-left py-2 px-3">Sesión</th>
                      <th className="text-left py-2 px-3">Razón</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {downloaded.failedDrivers.map(f => (
                      <tr key={f.key} className="hover:bg-red-900/10">
                        <td className="py-2 px-3 text-white">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.driver.color }} />
                            {f.driver.name} <span className="text-gray-500 text-xs">#{f.driver.number}</span>
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-300">
                          {f.session.year} R{f.session.round} {f.session.sessionName}
                        </td>
                        <td className="py-2 px-3 text-red-300 font-mono text-xs break-all">{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Circuitos sin geometría */}
          {failedCircuits.length > 0 && (
            <div className="bg-amber-900/10 border border-amber-800/60 rounded-xl p-4 text-sm">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-amber-300 font-medium">
                  {failedCircuits.length} circuitos sin geometría completa
                </span>
              </div>
              <p className="text-gray-400 text-xs">
                {failedCircuits.map(c => c.circuitId).join(', ')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DataLoader;
