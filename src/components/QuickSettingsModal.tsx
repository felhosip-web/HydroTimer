import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Volume2,
  Vibrate,
  Moon,
  Check,
  Sparkles,
  Bell,
  BellRing,
  AlertTriangle,
  Timer,
  Clock,
  Plus,
  Edit2,
  Trash2,
} from 'lucide-react';
import { TimerConfig, SoundEffectType, VibrationPatternType, CustomEventItem } from '../types';
import { soundHaptics } from '../services/soundHaptics';

interface QuickSettingsModalProps {
  isOpen: boolean;
  config: TimerConfig;
  customEvents: CustomEventItem[];
  onClose: () => void;
  onSaveConfig: (newConfig: TimerConfig) => void;
  onOpenCreateEvent: () => void;
  onOpenEditEvent: (event: CustomEventItem) => void;
  onDeleteEvent: (eventId: string) => void;
}

export const QuickSettingsModal: React.FC<QuickSettingsModalProps> = ({
  isOpen,
  config,
  customEvents,
  onClose,
  onSaveConfig,
  onOpenCreateEvent,
  onOpenEditEvent,
  onDeleteEvent,
}) => {
  const [localConfig, setLocalConfig] = useState<TimerConfig>(() => ({
    ...config,
    alertDurationSeconds: Math.max(5, config.alertDurationSeconds || 15),
  }));

  const [isCustomAlertActive, setIsCustomAlertActive] = useState(false);
  const [customAlertVal, setCustomAlertVal] = useState('');

  useEffect(() => {
    const dur = Math.max(5, config.alertDurationSeconds || 15);
    setLocalConfig({
      ...config,
      alertDurationSeconds: dur,
    });
    if (![5, 15, 30].includes(dur)) {
      setIsCustomAlertActive(true);
      setCustomAlertVal(dur.toString());
    } else {
      setIsCustomAlertActive(false);
      setCustomAlertVal('');
    }
  }, [config, isOpen]);

  if (!isOpen) return null;

  const handleTestSound = (type: SoundEffectType) => {
    soundHaptics.playAlertSound(type);
  };

  const handleTestVibration = (pattern: VibrationPatternType) => {
    soundHaptics.triggerVibration(pattern);
  };

  const handleSelectEvent = (evt: CustomEventItem) => {
    setLocalConfig((prev) => ({
      ...prev,
      presetId: evt.id,
      title: evt.title,
      icon: evt.icon,
      intervalMinutes: evt.intervalMinutes,
      alertDurationSeconds: Math.max(5, evt.alertDurationSeconds || 15),
      soundType: evt.soundType,
      vibrationPattern: evt.vibrationPattern,
      intakeMlPerAlert: evt.intakeMl || 0,
    }));
  };

  const handleSelectPresetDuration = (sec: number) => {
    setIsCustomAlertActive(false);
    setLocalConfig((prev) => ({ ...prev, alertDurationSeconds: sec }));
  };

  const handleCustomDurationChange = (valStr: string) => {
    setCustomAlertVal(valStr);
    const num = parseInt(valStr, 10);
    if (!isNaN(num)) {
      const sanitized = Math.max(5, num);
      setLocalConfig((prev) => ({ ...prev, alertDurationSeconds: sanitized }));
    }
  };

  const soundOptions: { id: SoundEffectType; label: string; desc: string }[] = [
    { id: 'water_drop', label: 'Vízcsepp', desc: 'Akusztikus cseppenés' },
    { id: 'gentle_bell', label: 'Kristályharang', desc: 'Lágy zen harang' },
    { id: 'digital_beep', label: 'Okosóra Csipogás', desc: 'Dupla elektronikus ping' },
    { id: 'radar_pulse', label: 'Radar Pulzus', desc: 'Modern sweep hang' },
    { id: 'silent', label: 'Néma', desc: 'Csak rezgés' },
  ];

  const vibrationOptions: { id: VibrationPatternType; label: string; desc: string }[] = [
    { id: 'short', label: 'Rövid (150ms)', desc: 'Finom érintés' },
    { id: 'double', label: 'Dupla rezgés', desc: 'Standard óra jelzés' },
    { id: 'triple', label: 'Tripla pulzus', desc: 'Figyelemfelkeltő' },
    { id: 'long', label: 'Hosszú (600ms)', desc: 'Erőteljes jelzés' },
    { id: 'heartbeat', label: 'Szívdobbanás', desc: 'Ritmusos mintázat' },
  ];

  const intervalPresets = [5, 10, 15, 20, 30, 45, 60, 90, 120];
  const alertDurationPresets = [5, 15, 30];

  const handleSave = () => {
    let finalAlertDuration = localConfig.alertDurationSeconds;
    if (isCustomAlertActive && customAlertVal) {
      const n = parseInt(customAlertVal, 10);
      finalAlertDuration = isNaN(n) ? 15 : Math.max(5, n);
    } else {
      finalAlertDuration = Math.max(5, localConfig.alertDurationSeconds);
    }

    onSaveConfig({
      ...localConfig,
      alertDurationSeconds: finalAlertDuration,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-sky-400" />
                <span>Időzítő &amp; Esemény Beállítások</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Állítsd be az eseményeket (max. 6), jelzési időablakot (5s/15s/30s/egyéni) és hangokat
              </p>
            </div>
            <button
              id="close-settings-modal-btn"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-5 space-y-6">
            {/* Custom Events & Presets (Max 6) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span>Mentett Események</span>
                  <span className="text-[10px] bg-sky-500/20 text-sky-300 font-bold px-2 py-0.5 rounded-full border border-sky-500/30">
                    {customEvents.length}/6 esemény
                  </span>
                </label>
                {customEvents.length < 6 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCreateEvent();
                    }}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-800/50 px-2.5 py-1 rounded-xl transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Új Esemény Hozzáadása</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {customEvents.map((evt) => (
                  <div
                    key={evt.id}
                    onClick={() => handleSelectEvent(evt)}
                    className={`group p-3 rounded-2xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                      localConfig.presetId === evt.id
                        ? 'bg-sky-500/15 border-sky-500 text-sky-300 shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg">{evt.icon}</span>
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                            onOpenEditEvent(evt);
                          }}
                          className="p-1 text-slate-400 hover:text-white rounded"
                          title="Szerkesztés"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        {customEvents.length > 1 && !evt.isDefault && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteEvent(evt.id);
                            }}
                            className="p-1 text-slate-400 hover:text-rose-400 rounded"
                            title="Törlés"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-xs font-bold truncate">{evt.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {evt.intervalMinutes}p • {evt.alertDurationSeconds || 15}s jelzés
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interval Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Ismétlési Időköz
                </label>
                <span className="text-sm font-bold text-sky-400 font-mono">
                  {localConfig.intervalMinutes} perc
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {intervalPresets.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setLocalConfig({ ...localConfig, intervalMinutes: min })}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                      localConfig.intervalMinutes === min
                        ? 'bg-sky-500 text-white shadow-sm font-bold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {min}p
                  </button>
                ))}
              </div>
              <input
                type="range"
                min="1"
                max="180"
                step="1"
                value={localConfig.intervalMinutes}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, intervalMinutes: parseInt(e.target.value, 10) || 1 })
                }
                className="w-full accent-sky-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
              />
            </div>

            {/* Alert Duration & Timeout Window Setting (5s min, 5, 15, 30 + Custom) */}
            <div className="bg-gradient-to-br from-sky-950/40 via-slate-800/50 to-slate-900/60 border border-sky-500/30 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-300">
                    <BellRing className="w-4 h-4" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                      <span>Jelzési Időablak &amp; Nyugtázási Határidő</span>
                      <span className="text-[10px] bg-sky-500/20 text-sky-300 font-semibold px-2 py-0.5 rounded-full border border-sky-500/30">
                        min. 5 mp
                      </span>
                    </label>
                    <p className="text-[11px] text-slate-400">
                      Mennyi ideig szóljon a riasztás és várjon nyugtázásra
                    </p>
                  </div>
                </div>
                <span className="text-sm font-extrabold text-sky-300 font-mono bg-sky-950/70 border border-sky-800/80 px-2.5 py-1 rounded-xl">
                  {localConfig.alertDurationSeconds || 15} mp
                </span>
              </div>

              {/* Presets for Alert Duration: 5s, 15s, 30s + Custom button */}
              <div className="grid grid-cols-4 gap-1.5 my-2.5">
                {alertDurationPresets.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => handleSelectPresetDuration(sec)}
                    className={`py-2 px-2 rounded-xl text-xs font-bold text-center transition-all ${
                      !isCustomAlertActive && (localConfig.alertDurationSeconds || 15) === sec
                        ? 'bg-sky-500 text-white shadow-sm'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {sec} mp
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setIsCustomAlertActive(true);
                    setCustomAlertVal(localConfig.alertDurationSeconds.toString());
                  }}
                  className={`py-2 px-2 rounded-xl text-xs font-bold text-center transition-all ${
                    isCustomAlertActive
                      ? 'bg-sky-500 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Egyéni ✏️
                </button>
              </div>

              {/* Custom input view if active */}
              {isCustomAlertActive && (
                <div className="mt-2.5 flex items-center gap-2 p-2.5 bg-slate-900/90 rounded-xl border border-sky-500/40">
                  <span className="text-xs text-slate-300 shrink-0 font-medium">Egyedi érték:</span>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    step="1"
                    placeholder="pl. 10, 25, 45, 90"
                    value={customAlertVal}
                    onChange={(e) => handleCustomDurationChange(e.target.value)}
                    className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono font-bold focus:outline-none focus:border-sky-400"
                  />
                  <span className="text-xs text-slate-400">másodperc (minimum 5 mp)</span>
                </div>
              )}

              {/* Functional Rule Explanation Banner */}
              <div className="mt-3 p-2.5 bg-slate-900/80 rounded-xl border border-slate-700/60 flex items-start gap-2 text-[11px] text-slate-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Automatikus továbbhaladás:</strong> Ha{' '}
                  <strong>{localConfig.alertDurationSeconds || 15} másodpercen</strong> belül nem érkezik nyugtázás,
                  a rendszer figyelmeztető üzenetet küld az elmulasztott jelzésről, és{' '}
                  <strong>automatikusan elindítja a következő {localConfig.intervalMinutes} perces időszakaszt</strong>.
                </span>
              </div>
            </div>

            {/* Sound Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-sky-400" />
                <span>Jelzőhang</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {soundOptions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setLocalConfig({ ...localConfig, soundType: s.id })}
                    className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      localConfig.soundType === s.id
                        ? 'bg-sky-500/15 border-sky-500 text-white'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold">{s.label}</div>
                      <div className="text-[10px] text-slate-400">{s.desc}</div>
                    </div>
                    {s.id !== 'silent' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTestSound(s.id);
                        }}
                        title="Hang meghallgatása"
                        className="p-1.5 bg-slate-700/80 hover:bg-slate-600 text-sky-300 rounded-lg text-xs"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Vibration Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                <Vibrate className="w-4 h-4 text-sky-400" />
                <span>Óra Rezgés Minta</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {vibrationOptions.map((v) => (
                  <div
                    key={v.id}
                    onClick={() => setLocalConfig({ ...localConfig, vibrationPattern: v.id })}
                    className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      localConfig.vibrationPattern === v.id
                        ? 'bg-sky-500/15 border-sky-500 text-white'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold">{v.label}</div>
                      <div className="text-[10px] text-slate-400">{v.desc}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTestVibration(v.id);
                      }}
                      title="Rezgés tesztelése"
                      className="p-1.5 bg-slate-700/80 hover:bg-slate-600 text-sky-300 rounded-lg text-xs"
                    >
                      <Vibrate className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Quiet Hours */}
            <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-purple-400" />
                  <div>
                    <div className="text-xs font-bold text-slate-200">Csendes Időszak (Ne Zavarj)</div>
                    <div className="text-[10px] text-slate-400">
                      Riasztási hangok és óra rezgések némítása a megadott idősávban (pl. 23:00 - 07:00)
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localConfig.quietHoursEnabled}
                  onChange={(e) => setLocalConfig({ ...localConfig, quietHoursEnabled: e.target.checked })}
                  className="w-5 h-5 accent-purple-500 rounded cursor-pointer"
                />
              </div>

              {localConfig.quietHoursEnabled && (
                <div className="space-y-3 pt-2 border-t border-slate-700/60">
                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 block mb-1">Gyors sablonok:</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: '23:00 – 07:00', start: '23:00', end: '07:00', hint: 'Klasszikus' },
                        { label: '22:00 – 06:00', start: '22:00', end: '06:00', hint: 'Korai' },
                        { label: '00:00 – 08:00', start: '00:00', end: '08:00', hint: 'Késői' },
                      ].map((preset) => {
                        const isMatch = localConfig.quietHoursStart === preset.start && localConfig.quietHoursEnd === preset.end;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              setLocalConfig({
                                ...localConfig,
                                quietHoursStart: preset.start,
                                quietHoursEnd: preset.end,
                              })
                            }
                            className={`py-1 px-1.5 rounded-xl text-[11px] font-bold transition-all text-center flex flex-col items-center ${
                              isMatch
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/60'
                            }`}
                          >
                            <span>{preset.label}</span>
                            <span className="text-[9px] opacity-70">{preset.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Kezdete (Elalvás)</label>
                      <input
                        type="time"
                        value={localConfig.quietHoursStart}
                        onChange={(e) => setLocalConfig({ ...localConfig, quietHoursStart: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Vége (Ébredés)</label>
                      <input
                        type="time"
                        value={localConfig.quietHoursEnd}
                        onChange={(e) => setLocalConfig({ ...localConfig, quietHoursEnd: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Active Days */}
            <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="text-xs font-bold text-slate-200">Aktív Napok</div>
                  <div className="text-[10px] text-slate-400">
                    Válaszd ki, mely napokon legyen aktív a jelzés
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-700/60 relative group">
                <select
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white appearance-none cursor-pointer focus:outline-none focus:border-sky-500 transition-colors"
                  onChange={(e) => {
                    const idx = parseInt(e.target.value);
                    const newActiveDays = [...(localConfig.activeDays || [true, true, true, true, true, true, true])];
                    newActiveDays[idx] = !newActiveDays[idx];
                    setLocalConfig({ ...localConfig, activeDays: newActiveDays });
                  }}
                  value="-1"
                >
                  <option value="-1" disabled hidden>Napok kiválasztása ▾</option>
                  {[
                    { index: 1, label: 'Hétfő' },
                    { index: 2, label: 'Kedd' },
                    { index: 3, label: 'Szerda' },
                    { index: 4, label: 'Csütörtök' },
                    { index: 5, label: 'Péntek' },
                    { index: 6, label: 'Szombat' },
                    { index: 0, label: 'Vasárnap' },
                  ].map((day) => {
                    const isActive = localConfig.activeDays ? localConfig.activeDays[day.index] : true;
                    return (
                      <option key={day.index} value={day.index}>
                        {isActive ? '✓ ' : '  '}{day.label}
                      </option>
                    );
                  })}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 mt-1 pointer-events-none text-slate-400">
                   ▾
                </div>
              </div>
            </div>

            {/* Goals */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Napi Víz Cél (ml)</label>
                <input
                  type="number"
                  step="100"
                  min="500"
                  max="6000"
                  value={localConfig.dailyGoalMl}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, dailyGoalMl: parseInt(e.target.value, 10) || 2000 })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Adag / Jelzés (ml)</label>
                <input
                  type="number"
                  step="50"
                  min="0"
                  max="1000"
                  value={localConfig.intakeMlPerAlert}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, intakeMlPerAlert: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Mégse
            </button>
            <button
              id="save-settings-btn"
              onClick={handleSave}
              className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Mentés & Alkalmazás</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
