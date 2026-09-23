export type TimerState = 'STOPPED' | 'WAITING' | 'ALERT_ACTIVE';

export interface TimerSnapshot {
  state: TimerState;
  timerGeneration: number;
  alertId: number | null;
  lastAlertId: number;
  nextTriggerAt: number | null;
  alertStartedAt: number | null;
  alertDeadlineAt: number | null;
}

export interface EngineConfig {
  mode: 'interval' | 'countdown';
  intervalMinutes: number;
  countdownMinutes: number;
  countdownSeconds: number;
  alertDurationSeconds: number;
  intervalMode: 'free' | 'clock';
  clockIntervalMinutes: number;
  autoRestart: boolean;
  intakePerAlertMl: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "23:00"
  quietHoursEnd: string;   // "07:00"
  activeDays: boolean[];   // Array of 7 booleans (index 0 = Sunday)
}

export type TimerEventType =
  | 'START'
  | 'STOP'
  | 'TIMER_TRIGGER'
  | 'ACKNOWLEDGE'
  | 'DRINK'
  | 'ALERT_TIMEOUT'
  | 'RECOVER';

export interface TimerEvent {
  type: TimerEventType;
  timerGeneration?: number | null;
  alertId?: number | null;
  timestamp: number;
}

export type TimerEffect =
  | { type: 'PersistState'; snapshot: TimerSnapshot }
  | { type: 'ScheduleTimer'; triggerAtMillis: number; timerGeneration: number }
  | { type: 'ScheduleAlertTimeout'; deadlineAtMillis: number; timerGeneration: number; alertId: number }
  | { type: 'CancelTimer'; timerGeneration: number }
  | { type: 'CancelAlertTimeout'; timerGeneration: number; alertId: number | null }
  | { type: 'ShowReminder'; title?: string | null; body?: string | null; timerGeneration: number; alertId: number }
  | { type: 'CancelReminder' }
  | { type: 'ShowMissedNotification'; alertDurationSeconds: number }
  | { type: 'RecordDrink'; amountMl: number }
  | { type: 'RecordAck' }
  | { type: 'RecordMissed' };

export interface TransitionResult {
  newSnapshot: TimerSnapshot;
  effects: TimerEffect[];
}
