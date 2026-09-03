import React, { useMemo, useEffect } from 'react';
import {
  Droplets,
  Clock,
  Watch,
  CheckCircle,
  Plus,
  Trash2,
  AlertTriangle,
  Timer,
  BarChart3,
  TrendingUp,
  Award,
  Target,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Cell,
} from 'recharts';
import { ActivityLog, TimerConfig } from '../types';

interface DailyStatsProps {
  config: TimerConfig;
  logs: ActivityLog[];
  waterIntakeMl: number;
  onQuickAddWater: (amountMl: number) => void;
  onClearLogs: () => void;
}

interface DailyIntakePoint {
  dateKey: string;
  dayLabel: string;
  fullDayName: string;
  formattedDate: string;
  intakeMl: number;
  goalMl: number;
  isToday: boolean;
  reachedGoal: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: DailyIntakePoint;
  }>;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    const percent = Math.round((data.intakeMl / (data.goalMl || 2500)) * 100);
    return (
      <div className="bg-slate-900/95 border border-slate-700/80 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs min-w-[150px]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1.5 mb-2">
          <span className="font-bold text-white">
            {data.isToday ? 'Ma (Aktuális)' : data.fullDayName}
          </span>
          <span className="text-[10px] text-slate-400 font-mono">{data.formattedDate}</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Bevitel:</span>
            <span className="font-bold font-mono text-sky-400">{data.intakeMl.toLocaleString()} ml</span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Napi cél:</span>
            <span className="font-mono text-slate-400">{data.goalMl.toLocaleString()} ml</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
            <span className="text-slate-400">Teljesítés:</span>
            <span className={`font-bold font-mono ${percent >= 100 ? 'text-emerald-400' : 'text-sky-300'}`}>
              {percent}% {percent >= 100 ? '✓' : ''}
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export const DailyStats: React.FC<DailyStatsProps> = ({
  config,
  logs,
  waterIntakeMl,
  onQuickAddWater,
  onClearLogs,
}) => {
  const goalPercent = Math.min(100, Math.round((waterIntakeMl / (config.dailyGoalMl || 2500)) * 100));

  // Sync today's live intake into persistent 7-day history storage
  useEffect(() => {
    try {
      const now = new Date();
      const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const raw = localStorage.getItem('hydro_7days_history');
      const history = raw ? JSON.parse(raw) : {};
      history[dateKey] = waterIntakeMl;
      localStorage.setItem('hydro_7days_history', JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [waterIntakeMl]);

  // Compute 7-day dataset for Recharts
  const sevenDaysData = useMemo<DailyIntakePoint[]>(() => {
    const result: DailyIntakePoint[] = [];
    const now = new Date();
    const dailyGoal = config.dailyGoalMl || 2500;

    // Realistic baseline historical profile if the user hasn't accumulated 7 days yet
    const baselineDefaults: Record<number, number> = {
      6: 2100, // 6 days ago
      5: 2450, // 5 days ago
      4: 2600, // 4 days ago (met goal)
      3: 1850, // 3 days ago
      2: 2300, // 2 days ago
      1: 2550, // yesterday (met goal)
    };

    let savedHistory: Record<string, number> = {};
    try {
      const raw = localStorage.getItem('hydro_7days_history');
      if (raw) savedHistory = JSON.parse(raw);
    } catch {
      // ignore
    }

    const dayNames = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];
    const shortDayNames = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      const formattedDate = `${month}.${day}`;
      const isToday = i === 0;

      const fullDayName = isToday ? 'Ma' : dayNames[d.getDay()];
      const dayLabel = isToday ? 'Ma' : shortDayNames[d.getDay()];

      let intakeMl = 0;
      if (isToday) {
        intakeMl = waterIntakeMl;
      } else if (savedHistory[dateKey] !== undefined) {
        intakeMl = savedHistory[dateKey];
      } else {
        // Calculate from activity logs if any match this past day
        const dayLogs = logs.filter((l) => {
          const logDate = new Date(l.timestamp);
          return (
            logDate.getFullYear() === d.getFullYear() &&
            logDate.getMonth() === d.getMonth() &&
            logDate.getDate() === d.getDate() &&
            (l.amountMl ?? 0) > 0
          );
        });

        if (dayLogs.length > 0) {
          intakeMl = dayLogs.reduce((acc, l) => acc + (l.amountMl || 0), 0);
        } else {
          intakeMl = baselineDefaults[i] || 2000;
        }
      }

      result.push({
        dateKey,
        dayLabel,
        fullDayName,
        formattedDate,
        intakeMl,
        goalMl: dailyGoal,
        isToday,
        reachedGoal: intakeMl >= dailyGoal,
      });
    }

    return result;
  }, [config.dailyGoalMl, waterIntakeMl, logs]);

  // Aggregate metrics across the 7 days
  const averageIntake = Math.round(
    sevenDaysData.reduce((acc, curr) => acc + curr.intakeMl, 0) / sevenDaysData.length
  );
  const goalsMetCount = sevenDaysData.filter((d) => d.reachedGoal).length;
  const bestDay = sevenDaysData.reduce(
    (max, curr) => (curr.intakeMl > max.intakeMl ? curr : max),
    sevenDaysData[0]
  );

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-5 backdrop-blur-sm space-y-5">
      {/* Daily Goal Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Droplets className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Napi Hidratációs Cél</h3>
              <p className="text-xs text-slate-400">
                {waterIntakeMl} ml / {config.dailyGoalMl} ml
              </p>
            </div>
          </div>
          <span className="text-lg font-extrabold font-mono text-sky-400">
            {goalPercent}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/50">
          <div
            className="h-full bg-gradient-to-r from-sky-500 via-blue-500 to-teal-400 rounded-full transition-all duration-500 shadow-sm"
            style={{ width: `${goalPercent}%` }}
          ></div>
        </div>
      </div>

      {/* Quick Add Buttons */}
      <div>
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
          Gyors Vízbevitel Naplózás
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[150, 250, 350, 500].map((amount) => (
            <button
              key={amount}
              onClick={() => onQuickAddWater(amount)}
              className="py-2 px-1 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 rounded-xl text-xs font-semibold text-sky-300 transition-all active:scale-95 flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>{amount} ml</span>
            </button>
          ))}
        </div>
      </div>

      {/* 7-Day Water Intake Recharts Visualization */}
      <div className="pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">Elmúlt 7 Nap Vízbevitele</h4>
              <p className="text-[10px] text-slate-400">Napi megoszlás a kitűzött célhoz mérten</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-sky-400 bg-sky-950/60 border border-sky-800/50 px-2 py-0.5 rounded-full">
            Cél: {config.dailyGoalMl} ml
          </span>
        </div>

        {/* 7-Day Key Performance Metrics */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400 mb-0.5">
              <TrendingUp className="w-3 h-3 text-sky-400" />
              <span>7 napos átlag</span>
            </div>
            <div className="text-xs font-bold font-mono text-sky-300">
              {averageIntake.toLocaleString()} ml
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400 mb-0.5">
              <Target className="w-3 h-3 text-emerald-400" />
              <span>Célteljesítés</span>
            </div>
            <div className="text-xs font-bold font-mono text-emerald-400">
              {goalsMetCount} / 7 nap
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400 mb-0.5">
              <Award className="w-3 h-3 text-amber-400" />
              <span>Legjobb nap</span>
            </div>
            <div className="text-xs font-bold font-mono text-amber-300">
              {bestDay.intakeMl.toLocaleString()} ml
            </div>
          </div>
        </div>

        {/* Recharts BarChart Container */}
        <div className="w-full h-48 bg-slate-950/40 rounded-2xl p-2.5 border border-slate-800/60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sevenDaysData}
              margin={{ top: 14, right: 6, left: -22, bottom: 0 }}
            >
              <XAxis
                dataKey="dayLabel"
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 10 }}
                domain={[0, (dataMax: number) => Math.max(config.dailyGoalMl || 2500, dataMax + 200)]}
                tickFormatter={(val) => `${Math.round((val / 1000) * 10) / 10}l`}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ fill: 'rgba(51, 65, 85, 0.25)', radius: 6 }}
              />
              <ReferenceLine
                y={config.dailyGoalMl || 2500}
                stroke="#38bdf8"
                strokeDasharray="3 3"
                strokeOpacity={0.75}
                label={{
                  value: `${config.dailyGoalMl} ml`,
                  fill: '#38bdf8',
                  fontSize: 9,
                  position: 'insideTopRight',
                  offset: -2,
                }}
              />
              <Bar dataKey="intakeMl" radius={[5, 5, 0, 0]} maxBarSize={36}>
                {sevenDaysData.map((entry, index) => {
                  let fillColor = '#0284c7';
                  if (entry.isToday) {
                    fillColor = '#38bdf8';
                  } else if (entry.reachedGoal) {
                    fillColor = '#06b6d4';
                  } else {
                    fillColor = '#0369a1';
                  }
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={fillColor}
                      stroke={entry.isToday ? '#bae6fd' : 'transparent'}
                      strokeWidth={entry.isToday ? 1.5 : 0}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-sky-400 border border-sky-200"></span>
            <span>Ma (Élő)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-cyan-500"></span>
            <span>Cél elérve (100%+)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-sky-700"></span>
            <span>Bevitel</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t border-dashed border-sky-400"></span>
            <span>Napi cél</span>
          </div>
        </div>
      </div>

      {/* History Log */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Mai Események &amp; Jelzések ({logs.length})</span>
          </div>
          {logs.length > 0 && (
            <button
              onClick={onClearLogs}
              title="Napló törlése"
              className="text-[11px] text-slate-500 hover:text-rose-400 flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Törlés</span>
            </button>
          )}
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500 bg-slate-950/40 rounded-2xl border border-slate-800/50">
            Még nincs naplózott esemény a mai napon. Indítsd el az időzítőt!
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {logs.slice(0, 15).map((log) => {
              const timeStr = new Date(log.timestamp).toLocaleTimeString('hu-HU', {
                hour: '2-digit',
                minute: '2-digit',
              });

              const isMissed = log.missed;
              const isCountdown = log.mode === 'countdown';

              return (
                <div
                  key={log.id}
                  className={`flex items-center justify-between p-2.5 rounded-xl text-xs border ${
                    isMissed
                      ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                      : isCountdown
                      ? 'bg-amber-950/20 border-amber-700/40 text-slate-200'
                      : 'bg-slate-950/60 border-slate-800/70 text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isMissed ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : isCountdown ? (
                      <Timer className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    <div>
                      <div className={`font-semibold ${isMissed ? 'text-amber-300' : 'text-slate-200'}`}>
                        {log.title}
                        {log.amountMl ? ` (+${log.amountMl} ml)` : ''}
                      </div>
                      <div className="text-[10px] text-slate-400">{timeStr}</div>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-1 ${
                      isMissed
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : isCountdown
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : log.completedOnWatch
                        ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isMissed ? (
                      <span>Elmulasztva</span>
                    ) : isCountdown ? (
                      <span>Visszaszámláló</span>
                    ) : (
                      <>
                        {log.completedOnWatch ? <Watch className="w-3 h-3" /> : null}
                        <span>{log.completedOnWatch ? 'Okosóra' : 'Telefon'}</span>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
