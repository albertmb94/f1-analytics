import { useState, useMemo, useEffect } from 'react';
import { useData } from './context/DataContext';
import DataLoader from './components/DataLoader';
import CircuitMapping from './components/CircuitMapping';
import TelemetryProcessing from './components/TelemetryProcessing';
import MLAnalysis from './components/MLAnalysis';
import Dashboard from './components/Dashboard';
import PredictiveSimulator from './components/PredictiveSimulator';
import RawData from './components/RawData';
import {
  Database,
  MapPin,
  Activity,
  Brain,
  LayoutDashboard,
  Calculator,
  Table,
  Settings,
  Bell,
  User,
  Menu,
  X,
  ChevronRight,
  Layers,
  Check as CheckIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const modules = [
  { 
    id: 'loader', 
    label: 'FastF1 Loader', 
    icon: Database, 
    color: 'blue',
    description: 'Descarga y selección de datos'
  },
  { 
    id: 'circuits', 
    label: 'Mapeo Topológico', 
    icon: MapPin, 
    color: 'red',
    description: 'FastF1 CircuitInfo + Clasificación de curvas'
  },
  { 
    id: 'telemetry', 
    label: 'Preprocesamiento', 
    icon: Activity, 
    color: 'yellow',
    description: 'Normalización, filtrado y degradación'
  },
  { 
    id: 'ml', 
    label: 'ML Engine', 
    icon: Brain, 
    color: 'purple',
    description: 'Clustering + Desacoplamiento Piloto/Máquina'
  },
  { 
    id: 'dashboard', 
    label: 'Dashboard', 
    icon: LayoutDashboard, 
    color: 'blue',
    description: 'Telemetría superpuesta espacialmente'
  },
  { 
    id: 'simulator', 
    label: 'Simulador', 
    icon: Calculator, 
    color: 'green',
    description: 'Monte Carlo Forecasting 2026'
  },
  { 
    id: 'rawdata', 
    label: 'Datos Brutos', 
    icon: Table, 
    color: 'cyan',
    description: 'Inspección y exportación de telemetría'
  },
];

const colorClasses: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  red: { bg: 'bg-red-600', text: 'text-red-400', border: 'border-red-700', glow: 'shadow-red-500/20' },
  yellow: { bg: 'bg-yellow-600', text: 'text-yellow-400', border: 'border-yellow-700', glow: 'shadow-yellow-500/20' },
  purple: { bg: 'bg-purple-600', text: 'text-purple-400', border: 'border-purple-700', glow: 'shadow-purple-500/20' },
  blue: { bg: 'bg-blue-600', text: 'text-blue-400', border: 'border-blue-700', glow: 'shadow-blue-500/20' },
  green: { bg: 'bg-green-600', text: 'text-green-400', border: 'border-green-700', glow: 'shadow-green-500/20' },
  cyan: { bg: 'bg-cyan-600', text: 'text-cyan-400', border: 'border-cyan-700', glow: 'shadow-cyan-500/20' },
};

function App() {
  const [activeModule, setActiveModule] = useState('loader');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showSessionPicker, setShowSessionPicker] = useState(false);

  const { downloaded, activeSessionKeys, setActiveSessionKeys } = useData();

  // Draft state for the modal: changes are committed when "Guardar" is pressed
  const [draftKeys, setDraftKeys] = useState<Set<string>>(new Set(activeSessionKeys));
  useEffect(() => { if (showSessionPicker) setDraftKeys(new Set(activeSessionKeys)); }, [showSessionPicker, activeSessionKeys]);

  const sessionsByEvent = useMemo(() => {
    const map = new Map<string, { year: number; round: number; eventName: string; circuit: string; sessions: typeof downloaded.sessions }>();
    downloaded.sessions.forEach(s => {
      const key = `${s.year}-${s.round}`;
      if (!map.has(key)) {
        map.set(key, { year: s.year, round: s.round, eventName: `${s.year} R${s.round}`, circuit: s.circuit, sessions: [] });
      }
      map.get(key)!.sessions.push(s);
    });
    return Array.from(map.values()).sort((a, b) => a.year - b.year || a.round - b.round);
  }, [downloaded.sessions]);

  const totalSessions = downloaded.sessions.length;
  const activeCount = activeSessionKeys.size;
  const sessionPickerDisabled = totalSessions === 0;

  const toggleDraft = (key: string) => {
    setDraftKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const activeModuleData = modules.find(m => m.id === activeModule);
  const colors = activeModuleData ? colorClasses[activeModuleData.color] : colorClasses.red;

  const renderModule = () => {
    switch (activeModule) {
      case 'loader':
        return <DataLoader />;
      case 'circuits':
        return <CircuitMapping />;
      case 'telemetry':
        return <TelemetryProcessing />;
      case 'ml':
        return <MLAnalysis />;
      case 'dashboard':
        return <Dashboard />;
      case 'simulator':
        return <PredictiveSimulator />;
      case 'rawdata':
        return <RawData />;
      default:
        return <DataLoader />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Welcome Modal */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-8 max-w-2xl mx-4 border border-gray-700 shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center">
                  <Activity className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">F1 Analytics Platform 2026</h1>
                  <p className="text-gray-400">Sistema Analítico de Misión Crítica</p>
                </div>
              </div>
              
              <div className="space-y-4 text-gray-300 mb-8">
                <p>
                  Bienvenido al sistema de telemetría y análisis predictivo de Fórmula 1. 
                  Esta plataforma procesa datos a 2Hz de 20 monoplazas durante toda la temporada.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div className="text-red-400 font-semibold mb-1">Stack Tecnológico</div>
                    <div className="text-sm text-gray-400">Polars • TimescaleDB • XGBoost • Streamlit</div>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div className="text-red-400 font-semibold mb-1">Capacidades</div>
                    <div className="text-sm text-gray-400">ML • Forecasting • Real-time Telemetry</div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowWelcome(false)}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
              >
                Iniciar Plataforma
                <ChevronRight className="w-5 h-5" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Sessions Picker Modal */}
      <AnimatePresence>
        {showSessionPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowSessionPicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <Layers className="w-5 h-5 text-blue-400" />
                  <div>
                    <h2 className="text-lg font-bold text-white">Sesiones activas</h2>
                    <p className="text-xs text-gray-400">Solo las marcadas se usarán para cálculos, análisis y predicciones.</p>
                  </div>
                </div>
                <button onClick={() => setShowSessionPicker(false)} className="p-2 hover:bg-gray-800 rounded-lg">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800 text-xs">
                <button
                  onClick={() => setDraftKeys(new Set(downloaded.sessions.map(s => `${s.year}_${s.round}_${s.sessionType}`)))}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-md"
                >
                  Seleccionar todo
                </button>
                <button
                  onClick={() => setDraftKeys(new Set())}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-md"
                >
                  Limpiar
                </button>
                <span className="ml-auto text-gray-500 font-mono">
                  {draftKeys.size} / {totalSessions} seleccionadas
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {sessionsByEvent.length === 0 && (
                  <p className="text-gray-500 text-center py-8">No hay sesiones descargadas todavía.</p>
                )}
                {sessionsByEvent.map(ev => (
                  <div key={`${ev.year}-${ev.round}`} className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
                    <div className="px-4 py-2 bg-gray-800 text-sm text-gray-300 font-medium border-b border-gray-700">
                      {ev.eventName} <span className="text-gray-500 font-normal">· {ev.circuit}</span>
                    </div>
                    <div className="divide-y divide-gray-700/50">
                      {ev.sessions.map(s => {
                        const key = `${s.year}_${s.round}_${s.sessionType}`;
                        const checked = draftKeys.has(key);
                        return (
                          <button
                            key={key}
                            onClick={() => toggleDraft(key)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-700/30 ${checked ? 'text-white' : 'text-gray-500'}`}
                          >
                            <span className={`w-5 h-5 rounded-md flex items-center justify-center border ${checked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 bg-gray-900'}`}>
                              {checked && <CheckIcon className="w-3 h-3 text-white" />}
                            </span>
                            <span className="font-mono text-xs px-2 py-0.5 rounded bg-gray-900 border border-gray-700">{s.sessionType}</span>
                            <span className="flex-1">{s.sessionName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-800">
                <button
                  onClick={() => setShowSessionPicker(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => { setActiveSessionKeys(draftKeys); setShowSessionPicker(false); }}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
                >
                  Guardar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 ${colors.bg} rounded-lg flex items-center justify-center shadow-lg ${colors.glow}`}>
                {activeModuleData && <activeModuleData.icon className="w-5 h-5 text-white" />}
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">F1 Analytics 2026</h1>
                <p className="text-gray-400 text-xs">{activeModuleData?.description}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => !sessionPickerDisabled && setShowSessionPicker(true)}
              disabled={sessionPickerDisabled}
              title={sessionPickerDisabled ? 'Descarga datos primero' : 'Sesiones activas'}
              className={`relative flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                sessionPickerDisabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-gray-800'
              }`}
            >
              <Layers className="w-5 h-5 text-gray-400" />
              {totalSessions > 0 && (
                <span className="text-xs font-mono text-gray-300">{activeCount}/{totalSessions}</span>
              )}
            </button>
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors relative">
              <Bell className="w-5 h-5 text-gray-400" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <Settings className="w-5 h-5 text-gray-400" />
            </button>
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm text-gray-300 hidden sm:block">Data Engineer</span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <motion.aside
          initial={false}
          animate={{ width: sidebarOpen ? 280 : 0 }}
          className="bg-gray-900 border-r border-gray-800 overflow-hidden sticky top-14 h-[calc(100vh-3.5rem)]"
        >
          <div className="p-4 w-[280px]">
            <nav className="space-y-2">
              {modules.map((module) => {
                const isActive = activeModule === module.id;
                const moduleColors = colorClasses[module.color];
                
                return (
                  <button
                    key={module.id}
                    onClick={() => setActiveModule(module.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      isActive 
                        ? `${moduleColors.bg} text-white shadow-lg ${moduleColors.glow}` 
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <module.icon className="w-5 h-5" />
                    <div className="text-left">
                      <div className="font-medium text-sm">{module.label}</div>
                      <div className={`text-xs ${isActive ? 'text-white/70' : 'text-gray-500'}`}>
                        Módulo {modules.indexOf(module) + 1}
                      </div>
                    </div>
                    {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
                  </button>
                );
              })}
            </nav>

            <div className="mt-8 pt-8 border-t border-gray-800">
              <div className="text-xs text-gray-500 mb-3 px-4">ESTADO DEL SISTEMA</div>
              <div className="space-y-2 px-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Database</span>
                  <span className="text-green-400 flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Connected
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">ML Models</span>
                  <span className="text-green-400 flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Active
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Last Update</span>
                  <span className="text-gray-500">2 min ago</span>
                </div>
              </div>
            </div>
          </div>
        </motion.aside>

        {/* Main Content */}
        <main className="flex-1 p-6 overflow-auto">
          <motion.div
            key={activeModule}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          >
            {renderModule()}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

export default App;
