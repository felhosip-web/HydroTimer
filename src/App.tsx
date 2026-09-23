/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Smartphone,
  Watch,
  Sliders,
  Droplets,
  Bell,
  HelpCircle,
  Github,
} from 'lucide-react';
import {
  TimerConfig,
  ActivityLog,
  BluetoothDeviceState,
  CustomEventItem,
  TimerMode,
} from './types';
import { soundHaptics } from './services/soundHaptics';
import { bluetoothWatch } from './services/bluetoothWatch';
import { PhoneDashboard } from './components/PhoneDashboard';
import { SmartwatchSimulator } from './components/SmartwatchSimulator';
import { DailyStats } from './components/DailyStats';
import { QuickSettingsModal } from './components/QuickSettingsModal';
import { NativeCodeViewer } from './components/NativeCodeViewer';
import { CompatibilityGuideModal } from './components/CompatibilityGuideModal';
import { useTimerController } from './hooks/useTimerController';

const DEFAULT_CUSTOM_EVENTS: CustomEventItem[] = [
  {
    id: 'event_water',
    title: 'Vízivás',
    icon: 'water',
    intervalMinutes: 30,
    alertDurationSeconds: 15,
    soundType: 'water_drop',
    vibrationPattern: 'double',
    intakeMl: 250,
  },
  {
    id: 'event_stretch',
    title: 'Felállás & Nyújtás',
    icon: 'stretch',
    intervalMinutes: 45,
    alertDurationSeconds: 15,
    soundType: 'gentle_bell',
    vibrationPattern: 'double',
    intakeMl: 0,
  },
  {
    id: 'event_eye',
    title: '20-20-20 Szemtorna',
    icon: 'eye',
    intervalMinutes: 20,
    alertDurationSeconds: 5,
    soundType: 'digital_beep',
    vibrationPattern: 'short',
    intakeMl: 0,
  },
  {
    id: 'event_medicine',
    title: 'Gyógyszer / Vitamin',
    icon: 'medicine',
    intervalMinutes: 120,
    alertDurationSeconds: 30,
    soundType: 'radar_pulse',
    vibrationPattern: 'long',
    intakeMl: 0,
  },
  {
    id: 'event_walk',
    title: 'Séta & Friss Levegő',
    icon: 'walk',
    intervalMinutes: 60,
    alertDurationSeconds: 15,
    soundType: 'gentle_bell',
    vibrationPattern: 'heartbeat',
    intakeMl: 0,
  },
  {
    id: 'event_focus',
    title: 'Fókusz & Légzés',
    icon: 'focus',
    intervalMinutes: 25,
    alertDurationSeconds: 5,
    soundType: 'gentle_bell',
    vibrationPattern: 'short',
    intakeMl: 0,
  },
];

const DEFAULT_CONFIG: TimerConfig = {
  mode: 'interval',
  presetId: 'water',
  title: 'Vízivás',
  intervalMinutes: 30,
  countdownMinutes: 5,
  countdownSeconds: 0,
  alertDurationSeconds: 15, // Min 5s, presets: 5, 15, 30 or custom
  intervalMode: 'free',
  clockIntervalMinutes: 30,
  soundType: 'water_drop',
  vibrationPattern: 'double',
  autoRestart: true,
  quietHoursEnabled: true,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  intakeMlPerAlert: 250,
  dailyGoalMl: 2500,
  customEvents: DEFAULT_CUSTOM_EVENTS,
  activeDays: [true, true, true, true, true, true, true],
};

export default function App() {
  const [config, setConfig] = useState<TimerConfig>(() => {
    try {
      const saved = localStorage.getItem('hydro_timer_config_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          alertDurationSeconds: Math.max(5, parsed.alertDurationSeconds || 15),
          customEvents: parsed.customEvents?.length ? parsed.customEvents : DEFAULT_CUSTOM_EVENTS,
          activeDays: parsed.activeDays?.length === 7 ? parsed.activeDays : [true, true, true, true, true, true, true],
        };
      }
      return DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  });

  const [waterIntakeMl, setWaterIntakeMl] = useState(() => {
    try {
      const saved = localStorage.getItem('hydro_water_today');
      return saved ? parseInt(saved) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const [logs, setLogs] = useState<ActivityLog[]>(() => {
    try {
      const saved = localStorage.getItem('hydro_activity_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [bluetoothState, setBluetoothState] = useState<BluetoothDeviceState>({
    isConnected: false,
    deviceName: null,
    batteryLevel: null,
    heartRate: null,
    isScanning: false,
    error: null,
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCodeViewerOpen, setIsCodeViewerOpen] = useState(false);
  const [isCompatGuideOpen, setIsCompatGuideOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'both' | 'phone' | 'watch' | 'stats'>('both');
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');

  // Quiet Hours check helper
  const isCurrentlyInQuietHours = useCallback(() => {
    if (!config.quietHoursEnabled) return false;
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = config.quietHoursStart.split(':').map(Number);
    const [endH, endM] = config.quietHoursEnd.split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    if (startTotal > endTotal) {
      return currentMins >= startTotal || currentMins < endTotal;
    } else {
      return currentMins >= startTotal && currentMins < endTotal;
    }
  }, [config.quietHoursEnabled, config.quietHoursStart, config.quietHoursEnd]);

  // Hook callbacks for domain engine side effects
  const handleRecordDrink = useCallback((amountMl: number) => {
    if (amountMl > 0) {
      setWaterIntakeMl((prev) => prev + amountMl);
    }
  }, []);

  const handleRecordAck = useCallback(() => {
    const newLog: ActivityLog = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      presetId: config.presetId,
      title: `${config.title} (Nyugtázva)`,
      mode: config.mode,
      amountMl: config.intakeMlPerAlert > 0 ? config.intakeMlPerAlert : undefined,
      completedOnWatch: false,
      missed: false,
    };
    setLogs((prev) => [newLog, ...prev]);

    confetti({
      particleCount: 40,
      spread: 55,
      origin: { y: 0.7 },
      colors: ['#10b981', '#38bdf8', '#34d399'],
    });
  }, [config.presetId, config.title, config.mode, config.intakeMlPerAlert]);

  const handleRecordMissed = useCallback((durationSec: number) => {
    const missedLog: ActivityLog = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      presetId: config.presetId,
      title: `${config.title} (Elmulasztva - ${durationSec}s lejárva)`,
      mode: config.mode,
      completedOnWatch: false,
      missed: true,
    };
    setLogs((prev) => [missedLog, ...prev]);
  }, [config.presetId, config.title, config.mode]);

  const handleShowReminder = useCallback(() => {
    const inQuietHours = isCurrentlyInQuietHours();
    if (!inQuietHours) {
      soundHaptics.playAlertSound(config.soundType);
      soundHaptics.triggerVibration(config.vibrationPattern);
      soundHaptics.sendSystemNotification(
        `⏰ ${config.title} Jelzés!`,
        `Nyugtázási időablak: ${Math.max(5, config.alertDurationSeconds || 15)} másodperc áll rendelkezésre!`
      );
    }

    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.8 },
      colors: ['#38bdf8', '#0284c7', '#06b6d4', '#f59e0b'],
    });
  }, [config, isCurrentlyInQuietHours]);

  // Connect Timer State Machine Controller
  const timerController = useTimerController({
    config,
    onRecordDrink: handleRecordDrink,
    onRecordAck: handleRecordAck,
    onRecordMissed: handleRecordMissed,
    onShowReminder: handleShowReminder,
  });

  // Check notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationStatus(Notification.permission);
    } else {
      setNotificationStatus('unsupported');
    }
  }, []);

  // Bluetooth watch listener
  useEffect(() => {
    bluetoothWatch.subscribe((state) => {
      setBluetoothState(state);
    });
  }, []);

  // Save config changes
  useEffect(() => {
    localStorage.setItem('hydro_timer_config_v2', JSON.stringify(config));
  }, [config]);

  // Save water intake & logs
  useEffect(() => {
    localStorage.setItem('hydro_water_today', waterIntakeMl.toString());
  }, [waterIntakeMl]);

  useEffect(() => {
    localStorage.setItem('hydro_activity_logs', JSON.stringify(logs));
  }, [logs]);

  // User Acknowledges Alert (with or without drinking/completing)
  const handleAcknowledgeAlert = (withWater: boolean, isWatch: boolean = false) => {
    if (isWatch && withWater && config.intakeMlPerAlert > 0) {
      // Mark as completed on watch log
      const watchLog: ActivityLog = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        presetId: config.presetId,
        title: `${config.title} (Órán Nyugtázva • +${config.intakeMlPerAlert}ml)`,
        mode: config.mode,
        amountMl: config.intakeMlPerAlert,
        completedOnWatch: true,
        missed: false,
      };
      setLogs((prev) => [watchLog, ...prev]);
    }
    timerController.acknowledge(withWater);
  };

  const handleToggleTimer = () => {
    if (timerController.isAlerting) {
      handleAcknowledgeAlert(false);
      return;
    }
    if (timerController.isRunning) {
      timerController.stopTimer();
    } else {
      timerController.startTimer();
    }
  };

  const handleResetTimer = () => {
    timerController.stopTimer();
  };

  const handleAdjustMinutes = (deltaMinutes: number) => {
    const newMins = Math.max(1, config.intervalMinutes + deltaMinutes);
    setConfig((prev) => ({ ...prev, intervalMinutes: newMins }));
    if (!timerController.isRunning && config.mode === 'interval') {
      timerController.startTimer();
    }
  };

  const handleSwitchMode = (mode: TimerMode) => {
    timerController.stopTimer();
    setConfig((prev) => ({ ...prev, mode }));
  };

  const handleSetCountdownDuration = (mins: number, secs: number = 0) => {
    setConfig((prev) => ({ ...prev, countdownMinutes: mins, countdownSeconds: secs }));
    if (!timerController.isRunning && config.mode === 'countdown') {
      timerController.startTimer();
    }
  };

  const handleUpdateAlertDuration = (seconds: number) => {
    const validSec = Math.max(5, seconds);
    setConfig((prev) => ({ ...prev, alertDurationSeconds: validSec }));
  };

  const handleSelectEvent = (event: CustomEventItem) => {
    timerController.stopTimer();
    setConfig((prev) => ({
      ...prev,
      title: event.title,
      intervalMinutes: event.intervalMinutes,
      alertDurationSeconds: Math.max(5, event.alertDurationSeconds || 15),
      soundType: event.soundType,
      vibrationPattern: event.vibrationPattern,
      intakeMlPerAlert: event.intakeMl || 0,
    }));
  };

  const handleSaveCustomEvent = (event: CustomEventItem) => {
    const existing = config.customEvents || [];
    const index = existing.findIndex((e) => e.id === event.id);
    let updated: CustomEventItem[];
    if (index >= 0) {
      updated = [...existing];
      updated[index] = event;
    } else {
      if (existing.length >= 6) {
        alert('Maximum 6 esemény / emlékeztető hozható létre.');
        return;
      }
      updated = [...existing, event];
    }
    setConfig((prev) => ({ ...prev, customEvents: updated }));
  };

  const handleDeleteCustomEvent = (id: string) => {
    const updated = (config.customEvents || []).filter((e) => e.id !== id);
    setConfig((prev) => ({ ...prev, customEvents: updated }));
  };

  const handleLogIntake = (amountMl: number, isWatch: boolean) => {
    setWaterIntakeMl((prev) => prev + amountMl);

    const newLog: ActivityLog = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      presetId: config.presetId,
      title: `${amountMl} ml ivás`,
      amountMl,
      completedOnWatch: isWatch,
      missed: false,
    };
    setLogs((prev) => [newLog, ...prev]);

    confetti({
      particleCount: 35,
      spread: 50,
      origin: { y: 0.7 },
      colors: ['#38bdf8', '#34d399', '#60a5fa'],
    });
  };

  const handleTriggerTestAlert = () => {
    timerController.triggerTestAlert();
  };

  const handleUpdateQuietHours = (enabled: boolean, start?: string, end?: string) => {
    setConfig((prev) => ({
      ...prev,
      quietHoursEnabled: enabled,
      quietHoursStart: start !== undefined ? start : prev.quietHoursStart,
      quietHoursEnd: end !== undefined ? end : prev.quietHoursEnd,
    }));
  };

  const handleRequestNotification = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationStatus(permission);
      if (permission === 'granted') {
        soundHaptics.sendSystemNotification(
          'HydroTimer Értesítések Bekapcsolva 💧',
          'Az ismétlődő és visszaszámláló jelzések időben megérkeznek a telefonodra és okosórádra!'
        );
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-sky-500/30">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-3.5 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-sky-500 via-blue-600 to-amber-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                <span>HydroTimer</span>
                <span className="text-[10px] bg-sky-500/20 text-sky-300 font-semibold px-2 py-0.5 rounded-full border border-sky-500/30">
                  Wear OS &amp; Android
                </span>
              </h1>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Ismétlődő &amp; Visszaszámláló időzítő &bull; 6 egyedi esemény slot &bull; Min. 5s jelzés
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Compatibility Guide Button */}
            <button
              id="open-compat-guide-btn"
              onClick={() => setIsCompatGuideOpen(true)}
              className="py-2 px-3 bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-800 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
              title="Honor & Okosóra beállítási útmutató"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Honor / Óra Útmutató</span>
            </button>

            {/* Native Code & GitHub APK Exporter Button */}
            <button
              id="open-native-code-btn"
              onClick={() => setIsCodeViewerOpen(true)}
              className="py-2 px-3 sm:px-3.5 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
              title="GitHub APK automatikus fordítás és teljes forráskód"
            >
              <Github className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">GitHub APK &amp; Forráskód</span>
              <span className="sm:hidden">GitHub APK</span>
            </button>

            {/* Settings Button */}
            <button
              id="open-settings-top-btn"
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 transition-colors"
              title="Beállítások"
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Notification Permission Banner if needed */}
      {notificationStatus === 'default' && (
        <div className="bg-gradient-to-r from-sky-950/80 via-blue-950/80 to-slate-900 border-b border-sky-800/40 px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-sky-200">
              <Bell className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                Engedélyezd a rendszerértesítéseket, hogy a háttérben is megkapd a jelzéseket!
              </span>
            </div>
            <button
              onClick={handleRequestNotification}
              className="px-3 py-1 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-lg text-xs transition-all shadow-sm shrink-0"
            >
              Engedélyezés
            </button>
          </div>
        </div>
      )}

      {/* Mobile Tab Switcher */}
      <div className="lg:hidden px-4 pt-3 max-w-md mx-auto w-full">
        <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-2xl border border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('phone')}
            className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'phone' || activeTab === 'both'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Telefon</span>
          </button>
          <button
            onClick={() => setActiveTab('watch')}
            className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'watch' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Watch className="w-3.5 h-3.5" />
            <span>Okosóra</span>
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'stats' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Droplets className="w-3.5 h-3.5" />
            <span>Napló</span>
          </button>
        </div>
      </div>

      {/* Main Container Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Phone Dashboard (Span 6 on LG) */}
        <div
          className={`lg:col-span-6 space-y-6 ${
            activeTab === 'watch' || activeTab === 'stats' ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 sm:p-6 backdrop-blur-sm shadow-xl">
            <PhoneDashboard
              config={config}
              remainingSeconds={timerController.remainingSeconds}
              totalSeconds={timerController.totalDuration}
              isRunning={timerController.isRunning}
              isAlerting={timerController.isAlerting}
              alertSecondsLeft={timerController.alertSecondsLeft}
              missedAlertNotice={timerController.missedAlertNotice}
              onToggleTimer={handleToggleTimer}
              onResetTimer={handleResetTimer}
              onAdjustMinutes={handleAdjustMinutes}
              onSelectEvent={handleSelectEvent}
              onSwitchMode={handleSwitchMode}
              onSetCountdownDuration={handleSetCountdownDuration}
              onUpdateAlertDuration={handleUpdateAlertDuration}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onTriggerTestAlert={handleTriggerTestAlert}
              onAcknowledgeAlert={(withWater) => handleAcknowledgeAlert(withWater, false)}
              onDismissMissedNotice={() => timerController.dismissMissedNotice()}
              onSaveCustomEvent={handleSaveCustomEvent}
              onDeleteCustomEvent={handleDeleteCustomEvent}
              isQuietHoursActive={isCurrentlyInQuietHours()}
              onUpdateQuietHours={handleUpdateQuietHours}
              onUpdateAutoRestart={(autoRestart) => setConfig((prev) => ({ ...prev, autoRestart }))}
            />
          </div>

          {/* Daily Stats component under phone dashboard on large screens */}
          <div className="hidden lg:block">
            <DailyStats
              config={config}
              logs={logs}
              waterIntakeMl={waterIntakeMl}
              onQuickAddWater={(ml) => handleLogIntake(ml, false)}
              onClearLogs={() => {
                setLogs([]);
                setWaterIntakeMl(0);
              }}
              onEditProgress={(newAmount) => setWaterIntakeMl(newAmount)}
            />
          </div>
        </div>

        {/* Right Column: Smartwatch Companion Simulator (Span 6 on LG) */}
        <div
          className={`lg:col-span-6 space-y-6 ${
            activeTab === 'phone' || activeTab === 'stats' ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 sm:p-6 backdrop-blur-sm shadow-xl flex flex-col items-center">
            <div className="text-center mb-2">
              <span className="text-xs font-bold text-sky-400 uppercase tracking-widest flex items-center justify-center gap-1.5">
                <Watch className="w-4 h-4" />
                <span>Wear OS &amp; Bluetooth Okosóra Companion</span>
              </span>
              <p className="text-xs text-slate-400 mt-1">
                Valós idejű szinkron &bull; Rezgő jelzés &bull; Visszaszámláló &amp; Nyugtázási ablak
              </p>
            </div>

            <SmartwatchSimulator
              config={config}
              remainingSeconds={timerController.remainingSeconds}
              totalSeconds={timerController.totalDuration}
              isRunning={timerController.isRunning}
              isAlerting={timerController.isAlerting}
              alertSecondsLeft={timerController.alertSecondsLeft}
              waterIntakeMl={waterIntakeMl}
              bluetoothState={bluetoothState}
              onLogIntake={(ml) => handleLogIntake(ml, true)}
              onAcknowledgeAlert={(withWater) => handleAcknowledgeAlert(withWater, true)}
              onToggleTimer={handleToggleTimer}
              onConnectBluetooth={() => bluetoothWatch.connectRealDevice()}
              onSimulateWatch={() => bluetoothWatch.simulateVirtualWatch()}
              onDisconnectBluetooth={() => bluetoothWatch.disconnect()}
              isQuietHoursActive={isCurrentlyInQuietHours()}
              onUpdateQuietHours={handleUpdateQuietHours}
            />
          </div>
        </div>

        {/* Mobile Stats View Tab */}
        <div className={`lg:hidden col-span-12 ${activeTab === 'stats' ? 'block' : 'hidden'}`}>
          <DailyStats
            config={config}
            logs={logs}
            waterIntakeMl={waterIntakeMl}
            onQuickAddWater={(ml) => handleLogIntake(ml, false)}
            onClearLogs={() => {
              setLogs([]);
              setWaterIntakeMl(0);
            }}
            onEditProgress={(newAmount) => setWaterIntakeMl(newAmount)}
          />
        </div>
      </main>

      {/* Modals */}
      <QuickSettingsModal
        isOpen={isSettingsOpen}
        config={config}
        onClose={() => setIsSettingsOpen(false)}
        onSaveConfig={(newConfig) => {
          setConfig(newConfig);
          if (timerController.isRunning) {
            timerController.startTimer();
          }
        }}
        onSelectEvent={handleSelectEvent}
      />

      <NativeCodeViewer
        isOpen={isCodeViewerOpen}
        onClose={() => setIsCodeViewerOpen(false)}
      />

      <CompatibilityGuideModal
        isOpen={isCompatGuideOpen}
        onClose={() => setIsCompatGuideOpen(false)}
      />

      {/* Footer Info */}
      <footer className="mt-auto border-t border-slate-900 bg-slate-950/60 py-4 px-4 text-center text-xs text-slate-500">
        <p>
          HydroTimer &copy; 2026 &bull; Natív Android AlarmManager, CountDownTimer &amp; Wear OS Data Layer szinkronizáció
        </p>
      </footer>
    </div>
  );
}
