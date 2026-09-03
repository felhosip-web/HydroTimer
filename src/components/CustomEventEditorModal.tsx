import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Droplets,
  Activity,
  Eye,
  Pill,
  Footprints,
  Brain,
  Bell,
  Heart,
  Volume2,
  Vibrate,
  Clock,
  Check,
  Sparkles,
} from 'lucide-react';
import { CustomEventItem, SoundEffectType, VibrationPatternType } from '../types';
import { soundHaptics } from '../services/soundHaptics';

interface CustomEventEditorModalProps {
  isOpen: boolean;
  eventToEdit: CustomEventItem | null;
  currentCount: number;
  onClose: () => void;
  onSave: (event: CustomEventItem) => void;
  onDelete?: (id: string) => void;
}

export const CustomEventEditorModal: React.FC<CustomEventEditorModalProps> = ({
  isOpen,
  eventToEdit,
  currentCount,
  onClose,
  onSave,
  onDelete,
}) => {
  const isEditing = !!eventToEdit;

  const [title, setTitle] = useState(eventToEdit?.title || 'Új Esemény');
  const [icon, setIcon] = useState<CustomEventItem['icon']>(eventToEdit?.icon || 'water');
  const [intervalMinutes, setIntervalMinutes] = useState(eventToEdit?.intervalMinutes || 30);
  const [alertDurationSeconds, setAlertDurationSeconds] = useState(
    Math.max(5, eventToEdit?.alertDurationSeconds || 15)
  );
  const [customAlertDurationInput, setCustomAlertDurationInput] = useState(
    (eventToEdit?.alertDurationSeconds || 15).toString()
  );
  const [isCustomDuration, setIsCustomDuration] = useState(
    ![5, 15, 30].includes(eventToEdit?.alertDurationSeconds || 15)
  );
  const [soundType, setSoundType] = useState<SoundEffectType>(eventToEdit?.soundType || 'water_drop');
  const [vibrationPattern, setVibrationPattern] = useState<VibrationPatternType>(
    eventToEdit?.vibrationPattern || 'double'
  );
  const [intakeMl, setIntakeMl] = useState(eventToEdit?.intakeMl || (icon === 'water' ? 250 : 0));
  const [color, setColor] = useState(eventToEdit?.color || '#0284c7');

  React.useEffect(() => {
    if (eventToEdit) {
      setTitle(eventToEdit.title);
      setIcon(eventToEdit.icon);
      setIntervalMinutes(eventToEdit.intervalMinutes);
      const dur = Math.max(5, eventToEdit.alertDurationSeconds || 15);
      setAlertDurationSeconds(dur);
      setCustomAlertDurationInput(dur.toString());
      setIsCustomDuration(![5, 15, 30].includes(dur));
      setSoundType(eventToEdit.soundType);
      setVibrationPattern(eventToEdit.vibrationPattern);
      setIntakeMl(eventToEdit.intakeMl || 0);
      setColor(eventToEdit.color || '#0284c7');
    } else {
      setTitle(`Esemény #${currentCount + 1}`);
      setIcon('bell');
      setIntervalMinutes(30);
      setAlertDurationSeconds(15);
      setCustomAlertDurationInput('15');
      setIsCustomDuration(false);
      setSoundType('gentle_bell');
      setVibrationPattern('double');
      setIntakeMl(0);
      setColor('#0284c7');
    }
  }, [eventToEdit, currentCount, isOpen]);

  if (!isOpen) return null;

  const iconOptions: { id: CustomEventItem['icon']; label: string; iconComponent: React.ReactNode }[] = [
    { id: 'water', label: 'Vízivás', iconComponent: <Droplets className="w-4 h-4 text-sky-400" /> },
    { id: 'stretch', label: 'Nyújtás', iconComponent: <Activity className="w-4 h-4 text-emerald-400" /> },
    { id: 'eye', label: 'Szemtorna', iconComponent: <Eye className="w-4 h-4 text-indigo-400" /> },
    { id: 'medicine', label: 'Gyógyszer', iconComponent: <Pill className="w-4 h-4 text-rose-400" /> },
    { id: 'walk', label: 'Séta', iconComponent: <Footprints className="w-4 h-4 text-amber-400" /> },
    { id: 'focus', label: 'Fókusz', iconComponent: <Brain className="w-4 h-4 text-purple-400" /> },
    { id: 'heart', label: 'Egészség', iconComponent: <Heart className="w-4 h-4 text-pink-400" /> },
    { id: 'bell', label: 'Jelzés', iconComponent: <Bell className="w-4 h-4 text-teal-400" /> },
  ];

  const soundOptions: { id: SoundEffectType; label: string }[] = [
    { id: 'water_drop', label: '💧 Vízcsepp' },
    { id: 'gentle_bell', label: '🔔 Harang' },
    { id: 'digital_beep', label: '📟 Csipogás' },
    { id: 'radar_pulse', label: '📡 Radar' },
    { id: 'silent', label: '🔕 Néma (Csak rezgés)' },
  ];

  const handleAlertDurationQuickSelect = (sec: number) => {
    setIsCustomDuration(false);
    setAlertDurationSeconds(sec);
    setCustomAlertDurationInput(sec.toString());
  };

  const handleCustomDurationChange = (valStr: string) => {
    setCustomAlertDurationInput(valStr);
    const parsed = parseInt(valStr);
    if (!isNaN(parsed) && parsed >= 5) {
      setAlertDurationSeconds(parsed);
    }
  };

  const handleSave = () => {
    if (!title.trim()) return;

    const finalAlertDuration = Math.max(5, alertDurationSeconds);

    const updatedEvent: CustomEventItem = {
      id: eventToEdit?.id || `custom_${Date.now()}`,
      title: title.trim(),
      icon,
      intervalMinutes: Math.max(1, intervalMinutes),
      alertDurationSeconds: finalAlertDuration,
      soundType,
      vibrationPattern,
      intakeMl: icon === 'water' ? Math.max(0, intakeMl) : intakeMl > 0 ? intakeMl : undefined,
      color,
    };

    onSave(updatedEvent);
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-2xl bg-sky-500/15 border border-sky-500/30 text-sky-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  {isEditing ? 'Esemény Szerkesztése' : 'Új Esemény Hozzáadása'}
                </h2>
                <p className="text-xs text-slate-400">
                  {currentCount}/6 egyéni értesítési és időzítési slot
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-5 space-y-5">
            {/* Title Input */}
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Esemény / Emlékeztető Neve
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Pl. Vízivás, Nyújtás, Szemtorna, Gyógyszer..."
                className="w-full bg-slate-800/90 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition-colors"
              />
            </div>

            {/* Icon Picker */}
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                Ikon Választása
              </label>
              <div className="grid grid-cols-4 gap-2">
                {iconOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setIcon(opt.id);
                      if (opt.id === 'water' && intakeMl === 0) setIntakeMl(250);
                    }}
                    className={`p-2.5 rounded-2xl border flex flex-col items-center gap-1.5 transition-all ${
                      icon === opt.id
                        ? 'bg-sky-500/20 border-sky-500 shadow-sm'
                        : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800 text-slate-400'
                    }`}
                  >
                    {opt.iconComponent}
                    <span className="text-[11px] font-medium text-slate-200">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Interval in Minutes */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Ismétlési Időköz (Percenként)
                </label>
                <span className="text-sm font-bold text-sky-400 font-mono">
                  {intervalMinutes} perc
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setIntervalMinutes(min)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                      intervalMinutes === min
                        ? 'bg-sky-500 text-white font-bold'
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
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 1)}
                className="w-full accent-sky-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
              />
            </div>

            {/* Alert Duration / Window (Min 5s, quick 5s/15s/30s + Custom input) */}
            <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="text-xs font-bold text-slate-200 block">
                    Jelzési Időablak (Nyugtázási Határidő)
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Legkisebb értéke <strong>5 másodperc</strong>. Ha lejár, automatikusan továbblép.
                  </p>
                </div>
                <span className="text-sm font-black text-amber-300 font-mono bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-xl">
                  {alertDurationSeconds} mp
                </span>
              </div>

              {/* Quick Select Buttons: 5s, 15s, 30s + Custom */}
              <div className="flex items-center gap-2 my-2.5 flex-wrap">
                {[5, 15, 30].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => handleAlertDurationQuickSelect(sec)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      !isCustomDuration && alertDurationSeconds === sec
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {sec} mp
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setIsCustomDuration(true)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    isCustomDuration
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  ✏️ Egyéni Érték
                </button>
              </div>

              {/* Custom Editable Value Input */}
              {isCustomDuration && (
                <div className="mt-2.5 p-3 bg-slate-900/90 rounded-xl border border-slate-700/80">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-300 whitespace-nowrap">
                      Egyedi másodperc (min. 5s):
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="600"
                      step="1"
                      value={customAlertDurationInput}
                      onChange={(e) => handleCustomDurationChange(e.target.value)}
                      onBlur={() => {
                        const val = parseInt(customAlertDurationInput);
                        if (isNaN(val) || val < 5) {
                          setCustomAlertDurationInput('5');
                          setAlertDurationSeconds(5);
                        }
                      }}
                      className="w-24 bg-slate-800 border border-slate-600 rounded-xl px-3 py-1 text-sm font-mono text-amber-300 text-center focus:outline-none focus:border-amber-400"
                    />
                    <span className="text-xs text-slate-400">másodperc</span>
                  </div>
                </div>
              )}
            </div>

            {/* Sound & Vibration Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Hangjelzés
                </label>
                <select
                  value={soundType}
                  onChange={(e) => setSoundType(e.target.value as SoundEffectType)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                >
                  {soundOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Óra Rezgésminta
                </label>
                <select
                  value={vibrationPattern}
                  onChange={(e) => setVibrationPattern(e.target.value as VibrationPatternType)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="short">Rövid rezgés (150ms)</option>
                  <option value="double">Dupla rezgés (standard)</option>
                  <option value="triple">Tripla pulzus</option>
                  <option value="long">Hosszú rezgés (600ms)</option>
                  <option value="heartbeat">Szívdobbanás minta</option>
                </select>
              </div>
            </div>

            {/* If Water, Intake Amount */}
            {icon === 'water' && (
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Vízmennyiség jelzésenként (ml)
                </label>
                <input
                  type="number"
                  step="50"
                  min="50"
                  max="1000"
                  value={intakeMl}
                  onChange={(e) => setIntakeMl(parseInt(e.target.value) || 250)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
            {isEditing && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (eventToEdit) onDelete(eventToEdit.id);
                  onClose();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-rose-400 hover:bg-rose-950/40 hover:border-rose-800 border border-transparent transition-all flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Törlés</span>
              </button>
            ) : (
              <div></div>
            )}

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Mégse
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{isEditing ? 'Módosítások Mentése' : 'Esemény Létrehozása'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
