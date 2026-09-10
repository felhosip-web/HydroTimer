import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  Plus,
  Minus,
  Bell,
  BellRing,
  Sliders,
  Volume2,
  Droplets,
  Sparkles,
  Check,
  AlertTriangle,
  Clock,
  X,
  Timer,
  Repeat,
  Edit2,
  Trash2,
  Activity,
  Eye,
  Pill,
  Footprints,
  Brain,
  Heart,
  Moon,
} from 'lucide-react';
import { TimerConfig, CustomEventItem, TimerMode } from '../types';
import { CustomEventEditorModal } from './CustomEventEditorModal';

interface PhoneDashboardProps {
  config: TimerConfig;
  remainingSeconds: number;
  totalSeconds: number;
  isRunning: boolean;
  isAlerting: boolean;
  alertSecondsLeft: number;
  missedAlertNotice: { title: string; timeStr: string; alertDuration: number } | null;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onAdjustMinutes: (deltaMinutes: number) => void;
  onSelectEvent: (event: CustomEventItem) => void;
  onSwitchMode: (mode: TimerMode) => void;
  onSetCountdownDuration: (minutes: number, seconds?: number) => void;
  onUpdateAlertDuration: (seconds: number) => void;
  onOpenSettings: () => void;
  onTriggerTestAlert: () => void;
  onAcknowledgeAlert: (withWater: boolean) => void;
  onDismissMissedNotice: () => void;
  onSaveCustomEvent: (event: CustomEventItem) => void;
  onDeleteCustomEvent: (id: string) => void;
  isQuietHoursActive?: boolean;
  onUpdateQuietHours?: (enabled: boolean, start?: string, end?: string) => void;
  onUpdateAutoRestart?: (autoRestart: boolean) => void;
}

const calculateHoursDuration = (startStr: string, endStr: string) => {
  const [sH, sM] = (startStr || '23:00').split(':').map(Number);
  const [eH, eM] = (endStr || '07:00').split(':').map(Number);
  let startMins = (isNaN(sH) ? 23 : sH) * 60 + (isNaN(sM) ? 0 : sM);
  let endMins = (isNaN(eH) ? 7 : eH) * 60 + (isNaN(eM) ? 0 : eM);
  if (endMins <= startMins) {
    endMins += 24 * 60;
  }
  const diff = endMins - startMins;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return mins > 0 ? `${hours}ó ${mins}p` : `${hours} óra`;
};

export const PhoneDashboard: React.FC<PhoneDashboardProps> = ({
  config,
  remainingSeconds,
  totalSeconds,
  isRunning,
  isAlerting,
  alertSecondsLeft,
  missedAlertNotice,
  onToggleTimer,
  onResetTimer,
  onAdjustMinutes,
  onSelectEvent,
  onSwitchMode,
  onSetCountdownDuration,
  onUpdateAlertDuration,
  onOpenSettings,
  onTriggerTestAlert,
  onAcknowledgeAlert,
  onDismissMissedNotice,
  onSaveCustomEvent,
  onDeleteCustomEvent,
  isQuietHoursActive = false,
  onUpdateQuietHours,
  onUpdateAutoRestart,
}) => {
  const [isEditingEventModalOpen, setIsEditingEventModalOpen] = useState(false);
  const [selectedEventToEdit, setSelectedEventToEdit] = useState<CustomEventItem | null>(null);

  // Quick Countdown Input state
  const [customCountdownMins, setCustomCountdownMins] = useState(config.countdownMinutes || 5);
  const [customCountdownSecs, setCustomCountdownSecs] = useState(config.countdownSeconds || 0);
  const [showCustomCountdownInput, setShowCustomCountdownInput] = useState(false);

  // Custom Alert Duration Input inline state
  const [showCustomAlertInput, setShowCustomAlertInput] = useState(
    ![5, 15, 30].includes(config.alertDurationSeconds || 15)
  );
  const [customAlertInputVal, setCustomAlertInputVal] = useState(
    (config.alertDurationSeconds || 15).toString()
  );

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const progressPercent = totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0;
  const radius = 110;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Alert progress calculation
  const alertMaxSeconds = Math.max(5, config.alertDurationSeconds || 15);
  const alertProgressPercent = alertMaxSeconds > 0 ? (alertSecondsLeft / alertMaxSeconds) * 100 : 0;
  const alertStrokeDashoffset = circumference - (alertProgressPercent / 100) * circumference;

  const countdownPresets = [1, 3, 5, 10, 15, 20, 25, 30, 45, 60];

  const renderIcon = (iconType: CustomEventItem['icon']) => {
    switch (iconType) {
      case 'water':
        return <Droplets className="w-4 h-4 text-sky-400" />;
      case 'stretch':
        return <Activity className="w-4 h-4 text-emerald-400" />;
      case 'eye':
        return <Eye className="w-4 h-4 text-indigo-400" />;
      case 'medicine':
        return <Pill className="w-4 h-4 text-rose-400" />;
      case 'walk':
        return <Footprints className="w-4 h-4 text-amber-400" />;
      case 'focus':
        return <Brain className="w-4 h-4 text-purple-400" />;
      case 'heart':
        return <Heart className="w-4 h-4 text-pink-400" />;
      default:
        return <Bell className="w-4 h-4 text-teal-400" />;
    }
  };

  const handleApplyCustomCountdown = () => {
    const m = Math.max(0, customCountdownMins);
    const s = Math.max(0, Math.min(59, customCountdownSecs));
    if (m === 0 && s === 0) return;
    onSetCountdownDuration(m, s);
    setShowCustomCountdownInput(false);
  };

  const handleCustomAlertDurationSubmit = (valStr: string) => {
    setCustomAlertInputVal(valStr);
    const parsed = parseInt(valStr);
    if (!isNaN(parsed) && parsed >= 5) {
      onUpdateAlertDuration(parsed);
    }
  };

  return (
    <div className="flex flex-col items-center justify-between h-full space-y-6">
      {/* Missed Alert Warning Notice Banner */}
      <AnimatePresence>
        {missedAlertNotice && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            className="w-full bg-gradient-to-r from-rose-950/90 via-amber-950/80 to-slate-900 border border-amber-500/50 rounded-2xl p-3.5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="p-2 bg-amber-500/20 text-amber-300 rounded-xl border border-amber-500/30 shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5 text-amber-400 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-amber-200">
                      ⚠️ Elmulasztott jelzés!
                    </span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-mono font-medium">
                      {missedAlertNotice.timeStr}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 mt-1">
                    Nem érkezett nyugtázás a(z) <strong>{missedAlertNotice.title}</strong> jelzésre{' '}
                    <strong>{missedAlertNotice.alertDuration} mp</strong>-en belül.
                  </p>
                  <p className="text-[11px] text-sky-300 mt-1 font-medium flex items-center gap-1">
                    <span>⚡ A következő időszakasz automatikusan elindult!</span>
                  </p>
                </div>
              </div>
              <button
                onClick={onDismissMissedNotice}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors shrink-0"
                title="Értesítés bezárása"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOP PRIMARY MODE SWITCHER: Interval Loop vs Countdown Timer */}
      <div className="w-full bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800 shadow-inner grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => onSwitchMode('interval')}
          className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 ${
            config.mode === 'interval'
              ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Repeat className="w-4 h-4" />
          <span>Ismétlődő Emlékeztető</span>
        </button>

        <button
          type="button"
          onClick={() => onSwitchMode('countdown')}
          className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 ${
            config.mode === 'countdown'
              ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Timer className="w-4 h-4" />
          <span>Visszaszámláló</span>
        </button>
      </div>

      {/* CONDITIONAL HEADER CONTENT BASED ON MODE */}
      {config.mode === 'countdown' ? (
        /* COUNTDOWN MODE CONTROLS */
        <div className="w-full bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-wider">
              <Timer className="w-4 h-4" />
              <span>Visszaszámlálás Időtartama</span>
            </div>
            <button
              onClick={() => setShowCustomCountdownInput(!showCustomCountdownInput)}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{showCustomCountdownInput ? 'Gyors gombok' : 'Egyéni mm:ss'}</span>
            </button>
          </div>

          {showCustomCountdownInput ? (
            <div className="flex items-center gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={customCountdownMins}
                  onChange={(e) => setCustomCountdownMins(parseInt(e.target.value) || 0)}
                  className="w-16 bg-slate-800 border border-slate-700 rounded-lg p-2 text-center text-sm font-mono text-white"
                />
                <span className="text-xs text-slate-400">perc</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={customCountdownSecs}
                  onChange={(e) => setCustomCountdownSecs(parseInt(e.target.value) || 0)}
                  className="w-16 bg-slate-800 border border-slate-700 rounded-lg p-2 text-center text-sm font-mono text-white"
                />
                <span className="text-xs text-slate-400">mp</span>
              </div>
              <button
                type="button"
                onClick={handleApplyCustomCountdown}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow"
              >
                Alkalmaz
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {countdownPresets.map((mins) => {
                const isSelected = config.countdownMinutes === mins && (config.countdownSeconds || 0) === 0;
                return (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => onSetCountdownDuration(mins, 0)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {mins}p
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* INTERVAL MODE: 6 CUSTOM EVENT SLOTS */
        <div className="w-full">
          <div className="w-full bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800 shadow-inner grid grid-cols-2 gap-1.5 mb-4">
            <button
              type="button"
              onClick={() => onUpdateAutoRestart?.(true)}
              className={`py-2 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                config.autoRestart
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>Folyamatos</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateAutoRestart?.(false)}
              className={`py-2 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                !config.autoRestart
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Timer className="w-3.5 h-3.5" />
              <span>Egyszeri</span>
            </button>
          </div>

          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Események &amp; Emlékeztetők
              </span>
              <span className="text-[10px] bg-sky-500/20 text-sky-300 font-bold px-2 py-0.5 rounded-full border border-sky-500/30">
                {(config.customEvents || []).length} / 6 slot
              </span>
            </div>

            <div className="flex items-center gap-2">
              {(config.customEvents || []).length < 6 && (
                <button
                  onClick={() => {
                    setSelectedEventToEdit(null);
                    setIsEditingEventModalOpen(true);
                  }}
                  className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Új Esemény</span>
                </button>
              )}
              <button
                onClick={onOpenSettings}
                className="text-xs font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1"
              >
                <Sliders className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(config.customEvents || []).map((ev) => {
              const isActive = config.title === ev.title;
              return (
                <div
                  key={ev.id}
                  className={`p-2.5 rounded-2xl border transition-all text-left flex items-center justify-between group ${
                    isActive
                      ? 'bg-sky-500/15 border-sky-500 text-sky-200 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div
                    className="flex items-center gap-2 min-w-0 cursor-pointer flex-1"
                    onClick={() => onSelectEvent(ev)}
                  >
                    <div className="p-1.5 rounded-xl bg-slate-950/80 shrink-0">
                      {renderIcon(ev.icon)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{ev.title}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {ev.intervalMinutes}p • {ev.alertDurationSeconds || 15}s
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEventToEdit(ev);
                      setIsEditingEventModalOpen(true);
                    }}
                    title="Szerkesztés"
                    className="p-1 text-slate-500 hover:text-white rounded-lg opacity-80 hover:opacity-100 transition-opacity"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Countdown Display Circle (Normal mode or Alerting Mode) */}
      <div className="relative flex items-center justify-center py-2">
        {isAlerting ? (
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.9, 0.4] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="absolute w-80 h-80 rounded-full bg-amber-500/25 blur-3xl pointer-events-none"
          ></motion.div>
        ) : isRunning ? (
          <div
            className={`absolute w-72 h-72 rounded-full blur-2xl animate-pulse pointer-events-none ${
              config.mode === 'countdown' ? 'bg-amber-500/15' : 'bg-sky-500/10'
            }`}
          ></div>
        ) : null}

        <div
          className={`relative w-72 h-72 rounded-full border p-4 shadow-2xl flex flex-col items-center justify-center transition-all duration-300 ${
            isAlerting
              ? 'bg-gradient-to-b from-slate-900 via-amber-950/40 to-slate-900 border-amber-500 ring-4 ring-amber-500/30 shadow-amber-500/20'
              : 'bg-slate-900/90 border-slate-800/80'
          }`}
        >
          {/* Circular SVG Ring */}
          <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 288 288">
            <circle
              cx="144"
              cy="144"
              r={radius}
              className={isAlerting ? 'text-amber-950/60' : 'text-slate-800'}
              strokeWidth="10"
              stroke="currentColor"
              fill="transparent"
            />
            <circle
              cx="144"
              cy="144"
              r={radius}
              className={`transition-all duration-500 ease-linear shadow-lg ${
                isAlerting
                  ? 'text-amber-400'
                  : config.mode === 'countdown'
                  ? 'text-amber-500'
                  : 'text-sky-500'
              }`}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={isAlerting ? alertStrokeDashoffset : strokeDashoffset}
              strokeLinecap="round"
              stroke="currentColor"
              fill="transparent"
            />
          </svg>

          {/* Time text & status */}
          <div className="z-10 flex flex-col items-center text-center max-w-[200px]">
            {isAlerting ? (
              <>
                <motion.div
                  animate={{ scale: [1, 1.2, 1], rotate: [-10, 10, -10, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                  className="p-2 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 mb-1"
                >
                  <BellRing className="w-6 h-6" />
                </motion.div>

                <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  Riasztás Folyamatban!
                </div>

                <div className="text-4xl font-black font-mono tracking-tight text-white drop-shadow-sm my-0.5">
                  {alertSecondsLeft} <span className="text-lg font-normal text-amber-400">mp</span>
                </div>

                <div className="text-[10px] text-amber-200/90 font-medium">
                  Nyugtázási időablak ({config.alertDurationSeconds || 15}s)
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                  {config.mode === 'countdown' ? (
                    <span className="text-amber-400 flex items-center gap-1">
                      <Timer className="w-4 h-4" /> Visszaszámláló
                    </span>
                  ) : (
                    <span className="text-sky-400 flex items-center gap-1">
                      <Droplets className="w-4 h-4" /> {config.title}
                    </span>
                  )}
                </div>

                <motion.div
                  key={formattedTime}
                  initial={{ scale: 0.96 }}
                  animate={{ scale: 1 }}
                  className="text-5xl font-black font-mono tracking-tight text-white drop-shadow-sm"
                >
                  {formattedTime}
                </motion.div>

                <div className="mt-2 text-[11px] font-medium text-slate-300 bg-slate-800/90 px-3 py-1 rounded-full border border-slate-700/50 text-center">
                  {isRunning
                    ? config.mode === 'countdown'
                      ? '⏱️ Visszaszámlálás aktív'
                      : `${config.intervalMinutes}p ciklus • ${config.alertDurationSeconds || 15}mp jelzés`
                    : 'Szüneteltetve'}
                </div>

                {config.quietHoursEnabled && isQuietHoursActive && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-purple-300 bg-purple-950/80 border border-purple-800/60 px-2.5 py-0.5 rounded-full shadow-sm animate-pulse">
                    <Moon className="w-3 h-3 text-purple-400" />
                    <span>Csendes mód aktív ({config.quietHoursEnd}-ig némítva)</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ALERT DURATION SELECTOR (5s, 15s, 30s + Custom Editable Value) */}
      <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
            <BellRing className="w-3.5 h-3.5 text-amber-400" />
            <span>Jelzési Időablak (Nyugtázási ablak)</span>
          </div>
          <span className="text-xs font-extrabold text-amber-300 font-mono">
            {config.alertDurationSeconds || 15} mp
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {[5, 15, 30].map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => {
                setShowCustomAlertInput(false);
                onUpdateAlertDuration(sec);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                !showCustomAlertInput && (config.alertDurationSeconds || 15) === sec
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {sec} mp
            </button>
          ))}

          <button
            type="button"
            onClick={() => setShowCustomAlertInput(!showCustomAlertInput)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
              showCustomAlertInput
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            ✏️ Egyéni (mp)
          </button>
        </div>

        {showCustomAlertInput && (
          <div className="mt-2 flex items-center gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <label className="text-xs text-slate-300">Egyedi másodperc (min. 5s):</label>
            <input
              type="number"
              min="5"
              max="600"
              value={customAlertInputVal}
              onChange={(e) => handleCustomAlertDurationSubmit(e.target.value)}
              className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-sm font-mono text-amber-300 text-center focus:outline-none focus:border-amber-400"
            />
            <span className="text-xs text-slate-400">másodperc</span>
          </div>
        )}
      </div>

      {/* QUIET HOURS (CSENDES IDŐSZAK / NE ZAVARJ) CARD */}
      <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-sm transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl border transition-colors ${
                config.quietHoursEnabled
                  ? isQuietHoursActive
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-sm'
                    : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700/60'
              }`}
            >
              <Moon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-100">Csendes Időszak (Ne Zavarj)</span>
                {config.quietHoursEnabled && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      isQuietHoursActive
                        ? 'bg-purple-500/25 text-purple-300 border-purple-500/40 animate-pulse'
                        : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                    }`}
                  >
                    {isQuietHoursActive ? '🌙 Jelenleg aktív' : `${config.quietHoursStart} – ${config.quietHoursEnd}`}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {config.quietHoursEnabled
                  ? isQuietHoursActive
                    ? `A riasztások reggel ${config.quietHoursEnd}-ig némítva futnak (nincs hang és rezgés).`
                    : `Beállítva: ${config.quietHoursStart}-tól ${config.quietHoursEnd}-ig a riasztások automatikusan némulnak.`
                  : 'Kapcsold be az éjszakai némítást a zavartalan alváshoz.'}
              </p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer ml-2">
            <input
              type="checkbox"
              id="toggle-quiet-hours-dashboard"
              checked={config.quietHoursEnabled}
              onChange={(e) => onUpdateQuietHours?.(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
          </label>
        </div>

        {config.quietHoursEnabled && (
          <div className="mt-3 pt-3 border-t border-slate-800 space-y-2.5">
            {/* Presets */}
            <div>
              <div className="text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Gyors sablonok:</span>
                <span className="text-[10px] text-slate-400">
                  Időtartam: {calculateHoursDuration(config.quietHoursStart, config.quietHoursEnd)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: '23:00 – 07:00', start: '23:00', end: '07:00', hint: 'Klasszikus (8ó)' },
                  { label: '22:00 – 06:00', start: '22:00', end: '06:00', hint: 'Korai (8ó)' },
                  { label: '00:00 – 08:00', start: '00:00', end: '08:00', hint: 'Késői (8ó)' },
                ].map((preset) => {
                  const isMatch = config.quietHoursStart === preset.start && config.quietHoursEnd === preset.end;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onUpdateQuietHours?.(true, preset.start, preset.end)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold transition-all text-center flex flex-col items-center ${
                        isMatch
                          ? 'bg-purple-600 text-white shadow-sm border border-purple-400/50'
                          : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700/80 border border-slate-700/50'
                      }`}
                    >
                      <span>{preset.label}</span>
                      <span className={`text-[9px] ${isMatch ? 'text-purple-200' : 'text-slate-400'}`}>{preset.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom start & end time pickers */}
            <div className="grid grid-cols-2 gap-2 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-1">Kezdete (Elalvás)</label>
                <input
                  type="time"
                  value={config.quietHoursStart}
                  onChange={(e) => onUpdateQuietHours?.(true, e.target.value, config.quietHoursEnd)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-1">Vége (Ébredés)</label>
                <input
                  type="time"
                  value={config.quietHoursEnd}
                  onChange={(e) => onUpdateQuietHours?.(true, config.quietHoursStart, e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Alerting Mode Action Buttons vs Normal Control Buttons */}
      {isAlerting ? (
        <div className="w-full space-y-2">
          <button
            id="acknowledge-and-drink-btn"
            onClick={() => onAcknowledgeAlert(true)}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold rounded-2xl text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 active:scale-95 animate-bounce"
          >
            <Droplets className="w-5 h-5 fill-current" />
            <span>💧 Nyugtázás &amp; Ivás (+{config.intakeMlPerAlert} ml)</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              id="acknowledge-only-btn"
              onClick={() => onAcknowledgeAlert(false)}
              className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4 text-sky-400" />
              <span>Csak Nyugtázás</span>
            </button>

            <button
              onClick={onOpenSettings}
              className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium rounded-xl text-xs transition-all flex items-center justify-center gap-1"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              <span>Időablak ({config.alertDurationSeconds || 15}s)</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Quick interval modifiers for interval mode */}
          {config.mode === 'interval' && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => onAdjustMinutes(-5)}
                className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-2xl text-xs font-semibold transition-all flex items-center gap-1 active:scale-95"
                title="5 perc levonása"
              >
                <Minus className="w-4 h-4" />
                <span>5 perc</span>
              </button>

              <span className="text-xs text-slate-500 font-medium">Ciklusidő módosítása</span>

              <button
                onClick={() => onAdjustMinutes(5)}
                className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-2xl text-xs font-semibold transition-all flex items-center gap-1 active:scale-95"
                title="5 perc hozzáadása"
              >
                <Plus className="w-4 h-4" />
                <span>5 perc</span>
              </button>
            </div>
          )}

          {/* Primary Control Buttons */}
          <div className="w-full grid grid-cols-3 gap-3">
            <button
              id="reset-timer-btn"
              onClick={onResetTimer}
              className="py-3.5 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />
              <span>Újra</span>
            </button>

            <button
              id="toggle-timer-main-btn"
              onClick={onToggleTimer}
              className={`col-span-1 py-3.5 px-4 rounded-2xl text-sm font-extrabold transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95 ${
                isRunning
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                  : config.mode === 'countdown'
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                  : 'bg-sky-500 hover:bg-sky-400 text-white shadow-sky-500/25'
              }`}
            >
              {isRunning ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
              <span>{isRunning ? 'Szünet' : 'Indítás'}</span>
            </button>

            <button
              id="trigger-test-alert-btn"
              onClick={onTriggerTestAlert}
              title="Riasztás & Nyugtázási ablak tesztelése"
              className="py-3.5 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sky-400 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <Volume2 className="w-4 h-4" />
              <span>Teszt</span>
            </button>
          </div>
        </>
      )}

      {/* Modal for adding / editing custom event */}
      <CustomEventEditorModal
        isOpen={isEditingEventModalOpen}
        eventToEdit={selectedEventToEdit}
        currentCount={(config.customEvents || []).length}
        onClose={() => setIsEditingEventModalOpen(false)}
        onSave={onSaveCustomEvent}
        onDelete={onDeleteCustomEvent}
      />
    </div>
  );
};
