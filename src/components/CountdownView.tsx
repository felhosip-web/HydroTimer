import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import {
  Play,
  Pause,
  RotateCcw,
  Plus,
  Minus,
  Timer,
  BellRing,
  Volume2,
  Vibrate,
  Check,
  Sparkles,
  Sliders,
  Flame,
  Coffee,
  Brain,
  Zap,
} from 'lucide-react';
import { SoundEffectType, VibrationPatternType } from '../types';
import { soundHaptics } from '../services/soundHaptics';

interface CountdownViewProps {
  onNotifyWatch?: (title: string, remainingSec: number) => void;
  onLogCompleted?: (title: string, durationMinutes: number) => void;
}

const COUNTDOWN_PRESETS = [
  { label: '1 perc', minutes: 1, icon: '⚡' },
  { label: '3 perc', minutes: 3, icon: '🫖' },
  { label: '5 perc', minutes: 5, icon: '☕' },
  { label: '10 perc', minutes: 10, icon: '🧘' },
  { label: '15 perc', minutes: 15, icon: '👀' },
  { label: '25 perc', minutes: 25, icon: '🍅' }, // Pomodoro
  { label: '30 perc', minutes: 30, icon: '💪' },
  { label: '45 perc', minutes: 45, icon: '📚' },
  { label: '60 perc', minutes: 60, icon: '🎯' },
];

export const CountdownView: React.FC<CountdownViewProps> = ({
  onNotifyWatch,
  onLogCompleted,
}) => {
  const [inputHours, setInputHours] = useState(0);
  const [inputMinutes, setInputMinutes] = useState(5);
  const [inputSeconds, setInputSeconds] = useState(0);
  const [title, setTitle] = useState('Visszaszámláló');

  const [totalSeconds, setTotalSeconds] = useState(300);
  const [remainingSeconds, setRemainingSeconds] = useState(300);
  const [isRunning, setIsRunning] = useState(false);
  const [isAlerting, setIsAlerting] = useState(false);
  const [alertSecondsLeft, setAlertSecondsLeft] = useState(15);
  const [alertDurationSeconds, setAlertDurationSeconds] = useState(15);
  const [customAlertSeconds, setCustomAlertSeconds] = useState('');
  const [isCustomAlertActive, setIsCustomAlertActive] = useState(false);

  const [soundType, setSoundType] = useState<SoundEffectType>('gentle_bell');
  const [vibrationPattern, setVibrationPattern] = useState<VibrationPatternType>('triple');

  // Handle countdown tick
  useEffect(() => {
    if (!isRunning || isAlerting) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          triggerCountdownComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning, isAlerting]);

  // Handle alert window countdown
  useEffect(() => {
    if (!isAlerting) return;

    const alertTimer = setInterval(() => {
      setAlertSecondsLeft((prev) => {
        if (prev <= 1) {
          // Timeout reached
          handleAcknowledgeAlert();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(alertTimer);
  }, [isAlerting]);

  const triggerCountdownComplete = () => {
    setIsRunning(false);
    setIsAlerting(true);

    const dur = Math.max(5, isCustomAlertActive && customAlertSeconds ? parseInt(customAlertSeconds, 10) || 15 : alertDurationSeconds);
    setAlertSecondsLeft(dur);

    soundHaptics.playAlertSound(soundType);
    soundHaptics.triggerVibration(vibrationPattern);
    soundHaptics.sendSystemNotification(
      `⏳ ${title} Lejárt!`,
      `A visszaszámlálás befejeződött!`
    );

    confetti({
      particleCount: 70,
      spread: 80,
      origin: { y: 0.75 },
      colors: ['#38bdf8', '#fbbf24', '#34d399', '#f43f5e'],
    });

    if (onLogCompleted) {
      const durationMins = Math.round(totalSeconds / 60);
      onLogCompleted(title, durationMins);
    }
  };

  const handleStart = () => {
    const total = inputHours * 3600 + inputMinutes * 60 + inputSeconds;
    if (total <= 0) return;
    setTotalSeconds(total);
    setRemainingSeconds(total);
    setIsRunning(true);
    setIsAlerting(false);
  };

  const handleTogglePause = () => {
    if (remainingSeconds <= 0) {
      handleStart();
    } else {
      setIsRunning(!isRunning);
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    setIsAlerting(false);
    const total = inputHours * 3600 + inputMinutes * 60 + inputSeconds;
    setRemainingSeconds(total > 0 ? total : 300);
  };

  const handleAcknowledgeAlert = () => {
    setIsAlerting(false);
    handleReset();
  };

  const handleSelectPreset = (minutes: number, label: string) => {
    setInputHours(0);
    setInputMinutes(minutes);
    setInputSeconds(0);
    setTitle(label.includes('Pomodoro') ? 'Pomodoro Fókusz' : `${minutes} perces időzítő`);

    const total = minutes * 60;
    setTotalSeconds(total);
    setRemainingSeconds(total);
    setIsRunning(false);
    setIsAlerting(false);
  };

  const handleAddMinutes = (deltaMinutes: number) => {
    setRemainingSeconds((prev) => Math.max(1, prev + deltaMinutes * 60));
    setTotalSeconds((prev) => Math.max(1, prev + deltaMinutes * 60));
  };

  // Format remaining time
  const hrs = Math.floor(remainingSeconds / 3600);
  const mins = Math.floor((remainingSeconds % 3600) / 60);
  const secs = remainingSeconds % 60;

  const formattedTime = hrs > 0
    ? `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const progressPercent = totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0;
  const radius = 110;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  const alertMaxSec = alertDurationSeconds || 15;
  const alertProgressPercent = alertMaxSec > 0 ? (alertSecondsLeft / alertMaxSec) * 100 : 0;
  const alertStrokeDashoffset = circumference - (alertProgressPercent / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-between h-full space-y-6">
      {/* Top Presets */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-amber-400" />
            <span>Gyors Visszaszámlálók</span>
          </span>
          <span className="text-[11px] text-amber-400 font-medium font-mono">
            {totalSeconds > 0 ? `${Math.round(totalSeconds / 60)} perc` : ''}
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          {COUNTDOWN_PRESETS.map((p) => {
            const isPresetActive = totalSeconds === p.minutes * 60;
            return (
              <button
                key={p.minutes}
                type="button"
                onClick={() => handleSelectPreset(p.minutes, p.label)}
                className={`py-2 px-2 rounded-xl border text-center transition-all flex flex-col items-center justify-center ${
                  isPresetActive
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                    : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="text-sm">{p.icon}</span>
                <span className="text-xs font-bold mt-0.5">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Countdown Circle Display */}
      <div className="relative flex items-center justify-center py-2">
        {isAlerting ? (
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.9, 0.4] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="absolute w-80 h-80 rounded-full bg-amber-500/30 blur-3xl pointer-events-none"
          />
        ) : isRunning ? (
          <div className="absolute w-72 h-72 rounded-full bg-amber-500/15 blur-2xl animate-pulse pointer-events-none" />
        ) : null}

        <div
          className={`relative w-72 h-72 rounded-full border p-4 shadow-2xl flex flex-col items-center justify-center transition-all duration-300 ${
            isAlerting
              ? 'bg-gradient-to-b from-slate-900 via-amber-950/50 to-slate-900 border-amber-500 ring-4 ring-amber-500/40 shadow-amber-500/25'
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
                isAlerting ? 'text-amber-400' : 'text-amber-500'
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
                  Idő Lejárt!
                </div>

                <div className="text-4xl font-black font-mono tracking-tight text-white drop-shadow-sm my-0.5">
                  {alertSecondsLeft} <span className="text-lg font-normal text-amber-400">mp</span>
                </div>

                <div className="text-[10px] text-amber-200/90 font-medium">
                  Nyugtázási ablak
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-1">
                  <Timer className="w-4 h-4" />
                  <span>{title}</span>
                </div>

                <motion.div
                  key={formattedTime}
                  initial={{ scale: 0.96 }}
                  animate={{ scale: 1 }}
                  className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-white drop-shadow-sm"
                >
                  {formattedTime}
                </motion.div>

                <div className="mt-2 text-[11px] font-medium text-slate-300 bg-slate-800/90 px-3 py-1 rounded-full border border-slate-700/50 text-center">
                  {isRunning ? 'Visszaszámlálás aktív' : remainingSeconds === totalSeconds ? 'Készenlétben' : 'Szüneteltetve'}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Alerting Mode Action Buttons */}
      {isAlerting ? (
        <div className="w-full space-y-2">
          <button
            onClick={handleAcknowledgeAlert}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold rounded-2xl text-sm transition-all shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 active:scale-95 animate-bounce"
          >
            <Check className="w-5 h-5 stroke-[3]" />
            <span>✓ Visszaszámlálás Nyugtázása</span>
          </button>
        </div>
      ) : (
        <>
          {/* Quick Adjust Buttons (-1m, +1m, +5m) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAddMinutes(-1)}
              className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 active:scale-95"
            >
              <Minus className="w-3.5 h-3.5" />
              <span>1 perc</span>
            </button>

            <button
              onClick={() => handleAddMinutes(1)}
              className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>1 perc</span>
            </button>

            <button
              onClick={() => handleAddMinutes(5)}
              className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-amber-400 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>5 perc</span>
            </button>
          </div>

          {/* Primary Controls */}
          <div className="w-full grid grid-cols-2 gap-3">
            <button
              onClick={handleReset}
              className="py-3.5 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />
              <span>Újraindítás</span>
            </button>

            <button
              onClick={handleTogglePause}
              className={`py-3.5 px-4 rounded-2xl text-sm font-extrabold transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95 ${
                isRunning
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-amber-500/25'
              }`}
            >
              {isRunning ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
              <span>{isRunning ? 'Szüneteltetés' : 'Indítás'}</span>
            </button>
          </div>

          {/* Time Custom Setting Input Stepper (Hours / Minutes / Seconds) */}
          <div className="w-full p-3 bg-slate-900/60 border border-slate-800 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Egyedi idő beállítása</span>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>Jelzési ablak:</span>
                <span className="text-amber-400 font-mono font-bold">{alertDurationSeconds} mp</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Óra</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={inputHours}
                  onChange={(e) => setInputHours(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl py-1.5 px-2 text-center text-xs font-mono text-white font-bold"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Perc</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={inputMinutes}
                  onChange={(e) => setInputMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl py-1.5 px-2 text-center text-xs font-mono text-white font-bold"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Másodperc</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={inputSeconds}
                  onChange={(e) => setInputSeconds(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl py-1.5 px-2 text-center text-xs font-mono text-white font-bold"
                />
              </div>
            </div>

            {/* Alert Duration presets (5, 15, 30 + Egyéni) for Countdown */}
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-slate-400">Jelzési időablak:</span>
              <div className="flex items-center gap-1">
                {[5, 15, 30].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => {
                      setIsCustomAlertActive(false);
                      setAlertDurationSeconds(sec);
                    }}
                    className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-all ${
                      !isCustomAlertActive && alertDurationSeconds === sec
                        ? 'bg-amber-500 text-slate-950 font-bold'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomAlertActive(true);
                    setCustomAlertSeconds(alertDurationSeconds.toString());
                  }}
                  className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-all ${
                    isCustomAlertActive
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Egyéni
                </button>
              </div>
            </div>

            {isCustomAlertActive && (
              <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                <span className="text-[11px] text-slate-400">Egyedi másodperc (min. 5):</span>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={customAlertSeconds}
                  onChange={(e) => {
                    setCustomAlertSeconds(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n)) setAlertDurationSeconds(Math.max(5, n));
                  }}
                  className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-0.5 text-center text-xs text-amber-300 font-mono font-bold"
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
