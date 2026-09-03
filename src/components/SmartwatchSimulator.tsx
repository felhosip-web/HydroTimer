import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Watch,
  Heart,
  Battery,
  Droplets,
  Volume2,
  Bluetooth,
  Check,
  RefreshCw,
  Moon,
  Sun,
  Sparkles,
  BellRing,
  AlertCircle,
  Timer,
  Repeat,
} from 'lucide-react';
import { soundHaptics } from '../services/soundHaptics';
import { BluetoothDeviceState, TimerConfig } from '../types';

interface SmartwatchSimulatorProps {
  config: TimerConfig;
  remainingSeconds: number;
  totalSeconds: number;
  isRunning: boolean;
  isAlerting?: boolean;
  alertSecondsLeft?: number;
  waterIntakeMl: number;
  bluetoothState: BluetoothDeviceState;
  onLogIntake: (amountMl: number, isWatch: boolean) => void;
  onAcknowledgeAlert?: (withWater: boolean, isWatch: boolean) => void;
  onToggleTimer: () => void;
  onConnectBluetooth: () => void;
  onSimulateWatch: () => void;
  onDisconnectBluetooth: () => void;
  isQuietHoursActive?: boolean;
  onUpdateQuietHours?: (enabled: boolean, start?: string, end?: string) => void;
}

export const SmartwatchSimulator: React.FC<SmartwatchSimulatorProps> = ({
  config,
  remainingSeconds,
  totalSeconds,
  isRunning,
  isAlerting = false,
  alertSecondsLeft = 15,
  waterIntakeMl,
  bluetoothState,
  onLogIntake,
  onAcknowledgeAlert,
  onToggleTimer,
  onConnectBluetooth,
  onSimulateWatch,
  onDisconnectBluetooth,
  isQuietHoursActive = false,
  onUpdateQuietHours,
}) => {
  const [ambientMode, setAmbientMode] = useState(false);
  const [isWatchVibrating, setIsWatchVibrating] = useState(false);
  const [justLogged, setJustLogged] = useState(false);
  const [currentTimeStr, setCurrentTimeStr] = useState('12:00');

  // Sync vibrating state with isAlerting
  useEffect(() => {
    if (isAlerting) {
      setIsWatchVibrating(true);
    } else {
      setIsWatchVibrating(false);
    }
  }, [isAlerting]);

  // Clock in watch top header
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(
        now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const progressPercent = totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0;
  const radius = 108;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Alert progress for watch
  const alertMaxSeconds = Math.max(5, config.alertDurationSeconds || 15);
  const alertProgressPercent = alertMaxSeconds > 0 ? (alertSecondsLeft / alertMaxSeconds) * 100 : 0;
  const alertStrokeDashoffset = circumference - (alertProgressPercent / 100) * circumference;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const handleWatchDrink = () => {
    setJustLogged(true);
    setIsWatchVibrating(true);
    soundHaptics.playAlertSound(config.soundType);
    soundHaptics.triggerVibration(config.vibrationPattern);

    if (isAlerting && onAcknowledgeAlert) {
      onAcknowledgeAlert(true, true);
    } else {
      onLogIntake(config.intakeMlPerAlert, true);
    }

    setTimeout(() => {
      setJustLogged(false);
      if (!isAlerting) {
        setIsWatchVibrating(false);
      }
    }, 1200);
  };

  const handleWatchOnlyAck = () => {
    if (onAcknowledgeAlert) {
      onAcknowledgeAlert(false, true);
    }
  };

  const handleTestWatchHaptic = () => {
    setIsWatchVibrating(true);
    soundHaptics.playAlertSound(config.soundType);
    soundHaptics.triggerVibration(config.vibrationPattern);
    setTimeout(() => {
      if (!isAlerting) setIsWatchVibrating(false);
    }, 800);
  };

  return (
    <div id="smartwatch-companion-container" className="flex flex-col items-center justify-center p-4">
      {/* Top Status & Mode Toggle */}
      <div className="flex items-center justify-between w-full max-w-sm mb-4 px-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                bluetoothState.isConnected ? 'bg-emerald-400' : 'bg-sky-400'
              }`}
            ></span>
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                bluetoothState.isConnected ? 'bg-emerald-500' : 'bg-sky-500'
              }`}
            ></span>
          </span>
          <span className="text-xs font-medium text-slate-300">
            {bluetoothState.isConnected ? bluetoothState.deviceName : 'Wear OS Szimulátor'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            id="toggle-watch-quiet-mode-btn"
            onClick={() => onUpdateQuietHours?.(!config.quietHoursEnabled)}
            title={
              config.quietHoursEnabled
                ? `Csendes Mód aktív (${config.quietHoursStart}–${config.quietHoursEnd}) • Kattints a váltáshoz`
                : 'Csendes Mód bekapcsolása (Ne zavarj)'
            }
            className={`p-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
              config.quietHoursEnabled
                ? isQuietHoursActive
                  ? 'bg-purple-500/25 text-purple-300 border border-purple-500/50 shadow-sm animate-pulse'
                  : 'bg-purple-950/60 text-purple-300 border border-purple-800/40'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden sm:inline">
              {config.quietHoursEnabled ? (isQuietHoursActive ? 'Némítva' : 'Csendes') : 'DND'}
            </span>
          </button>

          <button
            id="toggle-ambient-mode-btn"
            onClick={() => setAmbientMode(!ambientMode)}
            title={ambientMode ? 'Kijelző ébresztése' : 'Always-On Ambient mód'}
            className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
              ambientMode
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {ambientMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <button
            id="test-watch-vibrate-btn"
            onClick={handleTestWatchHaptic}
            title="Rezgés & Hang tesztelése az órán"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg text-xs transition-colors flex items-center gap-1"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Smartwatch Outer Bezel Hardware */}
      <div className="relative flex items-center justify-center">
        {/* Watch Strap Top */}
        <div className="absolute -top-8 w-28 h-12 bg-gradient-to-b from-slate-900 to-slate-800 rounded-t-xl border-t border-x border-slate-700/60 shadow-md"></div>
        {/* Watch Strap Bottom */}
        <div className="absolute -bottom-8 w-28 h-12 bg-gradient-to-t from-slate-900 to-slate-800 rounded-b-xl border-b border-x border-slate-700/60 shadow-md"></div>

        {/* Rotary Crown Button on Right */}
        <button
          id="watch-crown-button"
          onClick={onToggleTimer}
          title="Forgókorona: Időzítő indítása/szüneteltetése"
          className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-4 h-11 bg-gradient-to-r from-slate-700 via-slate-500 to-slate-800 rounded-r-md shadow-lg border-y border-r border-slate-600 active:scale-95 cursor-pointer z-20 flex flex-col justify-around py-1 items-center"
        >
          <span className="w-2.5 h-[1px] bg-slate-400"></span>
          <span className="w-2.5 h-[1px] bg-slate-400"></span>
          <span className="w-2.5 h-[1px] bg-slate-400"></span>
        </button>

        {/* Secondary Side Button */}
        <button
          id="watch-secondary-button"
          onClick={handleWatchDrink}
          title="Gyors gomb: Nyugtázás"
          className="absolute -right-2.5 bottom-16 w-3 h-7 bg-slate-700 hover:bg-slate-600 rounded-r shadow border-y border-r border-slate-600 active:scale-95 cursor-pointer z-20"
        ></button>

        {/* Circular Outer Bezel */}
        <motion.div
          animate={isWatchVibrating || isAlerting ? { x: [-3, 3, -3, 3, 0], y: [-2, 2, -2, 2, 0] } : {}}
          transition={{ duration: 0.25, repeat: isWatchVibrating || isAlerting ? Infinity : 0 }}
          className={`relative w-72 h-72 rounded-full p-2.5 shadow-2xl transition-all duration-300 ${
            isAlerting
              ? 'ring-4 ring-amber-400 ring-offset-4 ring-offset-slate-950 shadow-amber-500/50'
              : isWatchVibrating
              ? 'ring-4 ring-sky-400 ring-offset-4 ring-offset-slate-950 shadow-sky-500/40'
              : 'ring-1 ring-slate-700/80 shadow-slate-950'
          } bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950`}
        >
          {/* Bezel Tick Marks / Dial */}
          <div className="absolute inset-2 rounded-full border border-slate-700/40 pointer-events-none">
            <div
              className={`absolute top-1 left-1/2 -translate-x-1/2 w-1 h-2 rounded-full ${
                isAlerting ? 'bg-amber-400' : config.mode === 'countdown' ? 'bg-amber-500' : 'bg-sky-500'
              }`}
            ></div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-2 bg-slate-600 rounded-full"></div>
            <div className="absolute left-1 top-1/2 -translate-y-1/2 w-2 h-1 bg-slate-600 rounded-full"></div>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 w-2 h-1 bg-slate-600 rounded-full"></div>
          </div>

          {/* AMOLED Glass Circular Screen */}
          <div
            className={`w-full h-full rounded-full overflow-hidden relative flex flex-col items-center justify-between p-4 select-none transition-colors duration-500 ${
              ambientMode ? 'bg-black text-slate-400' : 'bg-slate-950 text-white'
            }`}
          >
            {/* SVG Progress Ring */}
            {!ambientMode && (
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 256 256">
                <circle
                  cx="128"
                  cy="128"
                  r={radius}
                  className={isAlerting ? 'text-amber-950/70' : 'text-slate-800'}
                  strokeWidth="8"
                  stroke="currentColor"
                  fill="transparent"
                />
                <circle
                  cx="128"
                  cy="128"
                  r={radius}
                  className={`transition-all duration-500 ease-linear ${
                    isAlerting ? 'text-amber-400' : config.mode === 'countdown' ? 'text-amber-400' : 'text-sky-400'
                  }`}
                  strokeWidth="8"
                  strokeDasharray={circumference}
                  strokeDashoffset={isAlerting ? alertStrokeDashoffset : strokeDashoffset}
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                />
              </svg>
            )}

            {/* Watch Top Bar: Clock + Quiet Mode Icon + Battery */}
            <div className="w-full flex items-center justify-between px-3 pt-1 z-10">
              <span className="text-[11px] font-semibold tracking-wider text-slate-300">
                {currentTimeStr}
              </span>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {config.quietHoursEnabled && (
                  <span
                    title={isQuietHoursActive ? `Csendes mód aktív (${config.quietHoursEnd}-ig)` : `Csendes: ${config.quietHoursStart}-${config.quietHoursEnd}`}
                    className={`flex items-center ${isQuietHoursActive ? 'text-purple-400 animate-pulse' : 'text-slate-500'}`}
                  >
                    <Moon className="w-3 h-3 fill-current" />
                  </span>
                )}
                <Battery className="w-3 h-3 text-emerald-400" />
                <span>{bluetoothState.batteryLevel || 92}%</span>
              </div>
            </div>

            {/* Watch Center: Timer & Status (or Alerting Mode) */}
            <div className="flex flex-col items-center justify-center my-auto z-10 text-center">
              {isAlerting ? (
                <>
                  <div className="flex items-center gap-1 text-[11px] text-amber-300 font-bold mb-0.5">
                    <BellRing className="w-3.5 h-3.5 animate-bounce" />
                    <span>RIASZTÁS</span>
                  </div>

                  <motion.div
                    animate={{ scale: [0.95, 1.05, 0.95] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="font-mono font-black text-3xl text-amber-300 tracking-tight"
                  >
                    {alertSecondsLeft}s
                  </motion.div>

                  <div className="text-[9px] text-amber-200/80 mt-0.5">
                    Nyugtázási ablak ({config.alertDurationSeconds || 15}s)
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 text-xs font-medium mb-0.5">
                    {config.mode === 'countdown' ? (
                      <span className="text-amber-400 flex items-center gap-1">
                        <Timer className="w-3.5 h-3.5 animate-bounce" />
                        <span>Visszaszámláló</span>
                      </span>
                    ) : (
                      <span className="text-sky-400 flex items-center gap-1">
                        <Droplets className="w-3.5 h-3.5 animate-bounce" />
                        <span>{config.title}</span>
                      </span>
                    )}
                  </div>

                  <motion.div
                    key={formattedTime}
                    initial={{ scale: 0.95 }}
                    animate={{ scale: 1 }}
                    className={`font-mono font-bold tracking-tight ${
                      ambientMode ? 'text-3xl text-slate-200' : 'text-4xl text-white'
                    }`}
                  >
                    {isRunning
                      ? formattedTime
                      : config.mode === 'countdown'
                      ? `${config.countdownMinutes.toString().padStart(2, '0')}:${(config.countdownSeconds || 0).toString().padStart(2, '0')}`
                      : `${config.intervalMinutes}:00`}
                  </motion.div>

                  <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1 justify-center">
                    <span>
                      {isRunning
                        ? config.mode === 'countdown'
                          ? `⏱️ Visszaszámlálás (${config.countdownMinutes}p)`
                          : `Ciklus: ${config.intervalMinutes}p • ${config.alertDurationSeconds || 15}s`
                        : 'Szünetel'}
                    </span>
                  </div>

                  {config.quietHoursEnabled && isQuietHoursActive && (
                    <div className="flex items-center gap-1 text-[9px] font-medium text-purple-300 bg-purple-950/80 border border-purple-800/60 px-2 py-0.5 rounded-full mt-1 animate-pulse">
                      <Moon className="w-2.5 h-2.5 text-purple-400" />
                      <span>Csendes mód ({config.quietHoursEnd}-ig)</span>
                    </div>
                  )}

                  {bluetoothState.heartRate && (
                    <div className="flex items-center gap-1 text-[10px] text-rose-400 mt-1">
                      <Heart className="w-3 h-3 fill-rose-500" />
                      <span>{bluetoothState.heartRate} BPM</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Watch Bottom Bar: Action Button */}
            <div className="w-full flex flex-col items-center pb-1 z-10">
              <AnimatePresence mode="wait">
                {justLogged ? (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    className="flex items-center gap-1 text-xs font-bold text-emerald-400 py-1"
                  >
                    <Check className="w-4 h-4" />
                    <span>Nyugtázva!</span>
                  </motion.div>
                ) : isAlerting ? (
                  <div className="flex flex-col gap-1 w-full items-center">
                    <motion.button
                      id="watch-drink-water-action-btn"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={handleWatchDrink}
                      className="w-full max-w-[170px] py-1.5 px-2.5 rounded-full text-xs font-extrabold bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-1 animate-pulse"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Nyugtázás</span>
                    </motion.button>
                  </div>
                ) : (
                  <motion.button
                    id="watch-drink-water-action-btn"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={handleWatchDrink}
                    className={`w-full max-w-[170px] py-1.5 px-3 rounded-full text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 ${
                      ambientMode
                        ? 'bg-slate-900 border border-slate-700 text-slate-200'
                        : config.mode === 'countdown'
                        ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-500/25'
                        : 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sky-500/25 hover:from-sky-400 hover:to-blue-500'
                    }`}
                  >
                    {config.mode === 'countdown' ? (
                      <>
                        <Timer className="w-3.5 h-3.5" />
                        <span>{isRunning ? 'Fut a visszaszámlálás' : 'Indítás'}</span>
                      </>
                    ) : (
                      <>
                        <Droplets className="w-3.5 h-3.5" />
                        <span>+{config.intakeMlPerAlert} ml Ivás</span>
                      </>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Watch Hardware Info & Bluetooth Pairing Controls */}
      <div className="mt-6 w-full max-w-sm bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 backdrop-blur-sm">
        <div className="flex items-center justify-between text-xs text-slate-300 mb-2.5">
          <div className="flex items-center gap-1.5 font-medium">
            <Bluetooth className="w-4 h-4 text-sky-400" />
            <span>Okosóra Kapcsolat</span>
          </div>
          <span className="text-[11px] text-slate-400">
            {bluetoothState.isConnected ? 'Aktív szinkron' : 'Nincs csatlakoztatva'}
          </span>
        </div>

        {bluetoothState.error && (
          <div className="mb-2 text-[11px] text-rose-400 bg-rose-950/40 border border-rose-800/40 rounded-lg p-2">
            {bluetoothState.error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {!bluetoothState.isConnected ? (
            <>
              <button
                id="connect-real-ble-watch-btn"
                onClick={onConnectBluetooth}
                disabled={bluetoothState.isScanning}
                className="py-2 px-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                {bluetoothState.isScanning ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Keresés...</span>
                  </>
                ) : (
                  <>
                    <Bluetooth className="w-3.5 h-3.5" />
                    <span>Valós Óra (BLE)</span>
                  </>
                )}
              </button>

              <button
                id="simulate-wearos-watch-btn"
                onClick={onSimulateWatch}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Wear OS Szimuláció</span>
              </button>
            </>
          ) : (
            <>
              <div className="col-span-1 text-[11px] text-slate-300 flex items-center gap-1 bg-slate-950/60 rounded-xl px-2.5 py-1.5 border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="truncate">{bluetoothState.deviceName}</span>
              </div>
              <button
                id="disconnect-bluetooth-btn"
                onClick={onDisconnectBluetooth}
                className="col-span-1 py-1.5 px-3 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 rounded-xl text-xs font-semibold transition-all"
              >
                Lecsatlakozás
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
