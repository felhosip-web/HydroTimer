import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar, RotateCw, AlertCircle, Clock } from 'lucide-react';
import { HydrationEvent, HydrationEventStatus } from '../domain/eventlog/types';
import { HydrationEventRepository } from '../domain/eventlog/HydrationEventRepository';

interface EventLogViewProps {
  repository: HydrationEventRepository;
}

export const STATUS_CONFIG: Record<
  HydrationEventStatus,
  { label: string; bgClass: string; textClass: string; borderClass: string; dotClass: string }
> = {
  PENDING: {
    label: 'Függőben',
    bgClass: 'bg-amber-500/15',
    textClass: 'text-amber-300',
    borderClass: 'border-amber-500/30',
    dotClass: 'bg-amber-400',
  },
  DRANK: {
    label: 'Megtörtént',
    bgClass: 'bg-emerald-500/15',
    textClass: 'text-emerald-300',
    borderClass: 'border-emerald-500/30',
    dotClass: 'bg-emerald-400',
  },
  NOT_DRANK: {
    label: 'Nem történt meg',
    bgClass: 'bg-orange-500/15',
    textClass: 'text-orange-300',
    borderClass: 'border-orange-500/30',
    dotClass: 'bg-orange-400',
  },
  REJECTED: {
    label: 'Elutasítva',
    bgClass: 'bg-rose-500/15',
    textClass: 'text-rose-300',
    borderClass: 'border-rose-500/30',
    dotClass: 'bg-rose-400',
  },
};

function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}. ${m}. ${d}.`;
}

function isSameCalendarDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export const EventLogView: React.FC<EventLogViewProps> = ({ repository }) => {
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<HydrationEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const activeQueryTokenRef = useRef<number>(0);

  const fetchEventsForDate = useCallback(
    async (targetDate: Date) => {
      setIsLoading(true);
      setError(null);
      const currentToken = ++activeQueryTokenRef.current;

      try {
        const list = await repository.listByLocalDay(targetDate);

        if (currentToken !== activeQueryTokenRef.current) {
          return;
        }

        const sorted = [...list].sort((a, b) => b.scheduledAt - a.scheduledAt);
        setEvents(sorted);
        setIsLoading(false);
      } catch {
        if (currentToken !== activeQueryTokenRef.current) {
          return;
        }
        setIsLoading(false);
        setError('Nem sikerült az események betöltése.');
      }
    },
    [repository]
  );

  useEffect(() => {
    fetchEventsForDate(selectedDate);
  }, [selectedDate, fetchEventsForDate]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchEventsForDate(selectedDate);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedDate, fetchEventsForDate]);

  const today = new Date();
  const isTodaySelected = isSameCalendarDay(selectedDate, today);

  const handlePrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const handleNextDay = () => {
    if (isTodaySelected) return;
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);

    if (next > today && !isSameCalendarDay(next, today)) {
      return;
    }
    setSelectedDate(next);
  };

  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split('-').map(Number);
    const chosen = new Date(y, m - 1, d, 12, 0, 0);

    const now = new Date();
    if (chosen > now && !isSameCalendarDay(chosen, now)) {
      setSelectedDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
    } else {
      setSelectedDate(chosen);
    }
  };

  const todayIso = formatLocalDateKey(today);
  const selectedIso = formatLocalDateKey(selectedDate);

  return (
    <div className="space-y-4">
      {/* Date Navigation Header */}
      <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-2xl border border-slate-800">
        <button
          onClick={handlePrevDay}
          id="btn-prev-day"
          className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors flex items-center justify-center cursor-pointer"
          title="Előző nap"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-xs font-bold text-white font-mono">
            {formatDisplayDate(selectedDate)}
            {isTodaySelected && <span className="ml-1.5 text-[10px] text-sky-400 font-sans">(Ma)</span>}
          </span>

          <div className="relative">
            <input
              type="date"
              max={todayIso}
              value={selectedIso}
              onChange={handleDateInputChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              id="date-picker-input"
            />
            <button
              type="button"
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 text-[10px]"
              title="Dátum kiválasztása"
            >
              📅
            </button>
          </div>
        </div>

        <button
          onClick={handleNextDay}
          disabled={isTodaySelected}
          id="btn-next-day"
          className={`p-2 rounded-xl border transition-colors flex items-center justify-center ${
            isTodaySelected
              ? 'bg-slate-900/40 text-slate-600 border-slate-800/40 cursor-not-allowed'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800 cursor-pointer'
          }`}
          title="Következő nap"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Content Area */}
      {isLoading ? (
        <div className="text-center py-8 text-xs text-slate-400 bg-slate-950/40 rounded-2xl border border-slate-800/50 flex items-center justify-center gap-2">
          <RotateCw className="w-4 h-4 animate-spin text-sky-400" />
          <span>Események betöltése...</span>
        </div>
      ) : error ? (
        <div className="text-center py-6 px-4 bg-rose-950/20 rounded-2xl border border-rose-800/40 space-y-3">
          <div className="flex items-center justify-center gap-2 text-rose-300 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchEventsForDate(selectedDate)}
            className="px-3 py-1.5 bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-700/50 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
            id="btn-retry-events"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Újrapróbálkozás</span>
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-400 bg-slate-950/40 rounded-2xl border border-slate-800/50">
          Erre a napra nincs rögzített esemény.
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {events.map((event) => {
            const dateObj = new Date(event.scheduledAt);
            const timeStr = dateObj.toLocaleTimeString('hu-HU', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const cfg = STATUS_CONFIG[event.status] || STATUS_CONFIG.PENDING;

            return (
              <div
                key={event.id}
                className="flex items-center justify-between p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="font-bold font-mono text-slate-200 text-sm">{timeStr}</span>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 border ${cfg.bgClass} ${cfg.textClass} ${cfg.borderClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`}></span>
                  <span>{cfg.label}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
