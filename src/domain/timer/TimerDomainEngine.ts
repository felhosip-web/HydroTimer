import {
  TimerSnapshot,
  EngineConfig,
  TimerEvent,
  TransitionResult,
  TimerEffect,
} from './types';

export class TimerDomainEngine {
  public static processEvent(
    snapshot: TimerSnapshot,
    event: TimerEvent,
    config: EngineConfig,
    now: number = event.timestamp
  ): TransitionResult {
    switch (event.type) {
      case 'START':
        return this.handleStart(snapshot, config, now);
      case 'STOP':
        return this.handleStop(snapshot, event);
      case 'TIMER_TRIGGER':
        return this.handleTimerTrigger(snapshot, event, config, now);
      case 'ACKNOWLEDGE':
        return this.handleAcknowledge(snapshot, event, config, now);
      case 'DRINK':
        return this.handleDrink(snapshot, event, config, now);
      case 'ALERT_TIMEOUT':
        return this.handleAlertTimeout(snapshot, event, config, now);
      case 'RECOVER':
        return this.handleRecover(snapshot, config, now);
    }
  }

  private static handleStart(
    snapshot: TimerSnapshot,
    config: EngineConfig,
    now: number
  ): TransitionResult {
    const nextGen = snapshot.timerGeneration + 1;
    const nextTriggerAt = calculateNextTriggerAt(now, config);
    const newSnapshot: TimerSnapshot = {
      state: 'WAITING',
      timerGeneration: nextGen,
      alertId: null,
      lastAlertId: snapshot.lastAlertId,
      nextTriggerAt,
      alertStartedAt: null,
      alertDeadlineAt: null,
    };

    const effects: TimerEffect[] = [];
    if (snapshot.timerGeneration > 0) {
      effects.push({ type: 'CancelTimer', timerGeneration: snapshot.timerGeneration });
      effects.push({ type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: snapshot.alertId });
      effects.push({ type: 'CancelReminder' });
    }
    effects.push({ type: 'PersistState', snapshot: newSnapshot });
    effects.push({ type: 'ScheduleTimer', triggerAtMillis: nextTriggerAt, timerGeneration: nextGen });

    return { newSnapshot, effects };
  }

  private static handleStop(
    snapshot: TimerSnapshot,
    event: TimerEvent
  ): TransitionResult {
    if (event.timerGeneration === undefined || event.timerGeneration === null || event.timerGeneration !== snapshot.timerGeneration) {
      return { newSnapshot: snapshot, effects: [] };
    }

    const newSnapshot: TimerSnapshot = {
      ...snapshot,
      state: 'STOPPED',
      alertId: null,
      nextTriggerAt: null,
      alertStartedAt: null,
      alertDeadlineAt: null,
    };

    const effects: TimerEffect[] = [
      { type: 'PersistState', snapshot: newSnapshot },
      { type: 'CancelTimer', timerGeneration: snapshot.timerGeneration },
      { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: snapshot.alertId },
      { type: 'CancelReminder' },
    ];

    return { newSnapshot, effects };
  }

  private static handleTimerTrigger(
    snapshot: TimerSnapshot,
    event: TimerEvent,
    config: EngineConfig,
    now: number
  ): TransitionResult {
    if (snapshot.state !== 'WAITING') {
      return { newSnapshot: snapshot, effects: [] };
    }
    if (event.timerGeneration === undefined || event.timerGeneration === null || event.timerGeneration !== snapshot.timerGeneration) {
      return { newSnapshot: snapshot, effects: [] };
    }

    const inQuiet = config.quietHoursEnabled && isInQuietHoursAt(now, config.quietHoursStart, config.quietHoursEnd);
    const dayActive = isDayActiveAt(now, config.activeDays);

    if (inQuiet || !dayActive) {
      const nextTriggerAt = calculateNextTriggerAt(now, config);
      const newSnapshot: TimerSnapshot = {
        ...snapshot,
        nextTriggerAt,
      };
      const effects: TimerEffect[] = [
        { type: 'PersistState', snapshot: newSnapshot },
        { type: 'ScheduleTimer', triggerAtMillis: nextTriggerAt, timerGeneration: snapshot.timerGeneration },
      ];
      return { newSnapshot, effects };
    }

    const nextAlertId = Math.max(1000, snapshot.lastAlertId) + 1;
    const alertDurationMs = Math.max(5, config.alertDurationSeconds) * 1000;
    const alertStartedAt = now;
    const alertDeadlineAt = now + alertDurationMs;

    const newSnapshot: TimerSnapshot = {
      ...snapshot,
      state: 'ALERT_ACTIVE',
      alertId: nextAlertId,
      lastAlertId: nextAlertId,
      alertStartedAt,
      alertDeadlineAt,
      nextTriggerAt: null,
    };

    const effects: TimerEffect[] = [
      { type: 'PersistState', snapshot: newSnapshot },
      {
        type: 'ShowReminder',
        title: null,
        body: null,
        timerGeneration: snapshot.timerGeneration,
        alertId: nextAlertId,
      },
      {
        type: 'ScheduleAlertTimeout',
        deadlineAtMillis: alertDeadlineAt,
        timerGeneration: snapshot.timerGeneration,
        alertId: nextAlertId,
      },
    ];

    return { newSnapshot, effects };
  }

  private static handleAcknowledge(
    snapshot: TimerSnapshot,
    event: TimerEvent,
    config: EngineConfig,
    now: number
  ): TransitionResult {
    if (snapshot.state !== 'ALERT_ACTIVE') {
      return { newSnapshot: snapshot, effects: [] };
    }
    if (event.timerGeneration === undefined || event.timerGeneration === null || event.timerGeneration !== snapshot.timerGeneration) {
      return { newSnapshot: snapshot, effects: [] };
    }
    if (snapshot.alertId === null || event.alertId === undefined || event.alertId === null || event.alertId !== snapshot.alertId) {
      return { newSnapshot: snapshot, effects: [] };
    }

    const activeAlertId = snapshot.alertId;
    const isCountdown = config.mode === 'countdown';

    if (isCountdown) {
      const newSnapshot: TimerSnapshot = {
        ...snapshot,
        state: 'STOPPED',
        alertId: null,
        nextTriggerAt: null,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };
      const effects: TimerEffect[] = [
        { type: 'PersistState', snapshot: newSnapshot },
        { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: activeAlertId },
        { type: 'CancelReminder' },
        { type: 'RecordAck' },
      ];
      return { newSnapshot, effects };
    } else {
      const nextTriggerAt = calculateNextTriggerAt(now, config);
      const newSnapshot: TimerSnapshot = {
        ...snapshot,
        state: 'WAITING',
        alertId: null,
        nextTriggerAt,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };
      const effects: TimerEffect[] = [
        { type: 'PersistState', snapshot: newSnapshot },
        { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: activeAlertId },
        { type: 'CancelReminder' },
        { type: 'RecordAck' },
        { type: 'ScheduleTimer', triggerAtMillis: nextTriggerAt, timerGeneration: snapshot.timerGeneration },
      ];
      return { newSnapshot, effects };
    }
  }

  private static handleDrink(
    snapshot: TimerSnapshot,
    event: TimerEvent,
    config: EngineConfig,
    now: number
  ): TransitionResult {
    if (snapshot.state !== 'ALERT_ACTIVE') {
      return { newSnapshot: snapshot, effects: [] };
    }
    if (event.timerGeneration === undefined || event.timerGeneration === null || event.timerGeneration !== snapshot.timerGeneration) {
      return { newSnapshot: snapshot, effects: [] };
    }
    if (snapshot.alertId === null || event.alertId === undefined || event.alertId === null || event.alertId !== snapshot.alertId) {
      return { newSnapshot: snapshot, effects: [] };
    }

    const activeAlertId = snapshot.alertId;
    const intake = Math.max(0, config.intakePerAlertMl);
    const isCountdown = config.mode === 'countdown';

    if (isCountdown) {
      const newSnapshot: TimerSnapshot = {
        ...snapshot,
        state: 'STOPPED',
        alertId: null,
        nextTriggerAt: null,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };
      const effects: TimerEffect[] = [
        { type: 'PersistState', snapshot: newSnapshot },
        { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: activeAlertId },
        { type: 'CancelReminder' },
        { type: 'RecordDrink', amountMl: intake },
        { type: 'RecordAck' },
      ];
      return { newSnapshot, effects };
    } else {
      const nextTriggerAt = calculateNextTriggerAt(now, config);
      const newSnapshot: TimerSnapshot = {
        ...snapshot,
        state: 'WAITING',
        alertId: null,
        nextTriggerAt,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };
      const effects: TimerEffect[] = [
        { type: 'PersistState', snapshot: newSnapshot },
        { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: activeAlertId },
        { type: 'CancelReminder' },
        { type: 'RecordDrink', amountMl: intake },
        { type: 'RecordAck' },
        { type: 'ScheduleTimer', triggerAtMillis: nextTriggerAt, timerGeneration: snapshot.timerGeneration },
      ];
      return { newSnapshot, effects };
    }
  }

  private static handleAlertTimeout(
    snapshot: TimerSnapshot,
    event: TimerEvent,
    config: EngineConfig,
    now: number
  ): TransitionResult {
    if (snapshot.state !== 'ALERT_ACTIVE') {
      return { newSnapshot: snapshot, effects: [] };
    }
    if (event.timerGeneration === undefined || event.timerGeneration === null || event.timerGeneration !== snapshot.timerGeneration) {
      return { newSnapshot: snapshot, effects: [] };
    }
    if (snapshot.alertId === null || event.alertId === undefined || event.alertId === null || event.alertId !== snapshot.alertId) {
      return { newSnapshot: snapshot, effects: [] };
    }

    const activeAlertId = snapshot.alertId;
    const durationMs =
      snapshot.alertDeadlineAt !== null && snapshot.alertStartedAt !== null
        ? snapshot.alertDeadlineAt - snapshot.alertStartedAt
        : Math.max(5, config.alertDurationSeconds) * 1000;
    const durationSec = Math.max(5, Math.floor(durationMs / 1000));
    const isCountdown = config.mode === 'countdown';

    if (isCountdown) {
      const newSnapshot: TimerSnapshot = {
        ...snapshot,
        state: 'STOPPED',
        alertId: null,
        nextTriggerAt: null,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };
      const effects: TimerEffect[] = [
        { type: 'PersistState', snapshot: newSnapshot },
        { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: activeAlertId },
        { type: 'CancelReminder' },
        { type: 'RecordMissed' },
        { type: 'ShowMissedNotification', alertDurationSeconds: durationSec },
      ];
      return { newSnapshot, effects };
    } else {
      const nextTriggerAt = calculateNextTriggerAt(now, config);
      const newSnapshot: TimerSnapshot = {
        ...snapshot,
        state: 'WAITING',
        alertId: null,
        nextTriggerAt,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };
      const effects: TimerEffect[] = [
        { type: 'PersistState', snapshot: newSnapshot },
        { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: activeAlertId },
        { type: 'CancelReminder' },
        { type: 'RecordMissed' },
        { type: 'ShowMissedNotification', alertDurationSeconds: durationSec },
        { type: 'ScheduleTimer', triggerAtMillis: nextTriggerAt, timerGeneration: snapshot.timerGeneration },
      ];
      return { newSnapshot, effects };
    }
  }

  private static handleRecover(
    snapshot: TimerSnapshot,
    config: EngineConfig,
    now: number
  ): TransitionResult {
    switch (snapshot.state) {
      case 'STOPPED': {
        const effects: TimerEffect[] = [
          { type: 'PersistState', snapshot },
          { type: 'CancelTimer', timerGeneration: snapshot.timerGeneration },
          { type: 'CancelAlertTimeout', timerGeneration: snapshot.timerGeneration, alertId: snapshot.alertId },
        ];
        return { newSnapshot: snapshot, effects };
      }
      case 'WAITING': {
        const targetAt = snapshot.nextTriggerAt ?? now;
        if (now >= targetAt) {
          const overdueMs = now - targetAt;
          const maxGraceMs = Math.max(5, config.alertDurationSeconds) * 1000 * 2;
          if (overdueMs <= maxGraceMs) {
            const triggerEvent: TimerEvent = {
              type: 'TIMER_TRIGGER',
              timerGeneration: snapshot.timerGeneration,
              timestamp: now,
            };
            return this.processEvent(snapshot, triggerEvent, config, now);
          } else {
            const nextTriggerAt = calculateNextTriggerAt(now, config);
            const newSnapshot: TimerSnapshot = {
              ...snapshot,
              nextTriggerAt,
            };
            const effects: TimerEffect[] = [
              { type: 'PersistState', snapshot: newSnapshot },
              { type: 'ScheduleTimer', triggerAtMillis: nextTriggerAt, timerGeneration: snapshot.timerGeneration },
            ];
            return { newSnapshot, effects };
          }
        } else {
          const effects: TimerEffect[] = [
            { type: 'PersistState', snapshot },
            { type: 'ScheduleTimer', triggerAtMillis: targetAt, timerGeneration: snapshot.timerGeneration },
          ];
          return { newSnapshot: snapshot, effects };
        }
      }
      case 'ALERT_ACTIVE': {
        const deadlineAt = snapshot.alertDeadlineAt ?? now;
        if (now >= deadlineAt) {
          const timeoutEvent: TimerEvent = {
            type: 'ALERT_TIMEOUT',
            timerGeneration: snapshot.timerGeneration,
            alertId: snapshot.alertId,
            timestamp: now,
          };
          return this.processEvent(snapshot, timeoutEvent, config, now);
        } else {
          const activeAlertId = snapshot.alertId ?? Math.max(1001, snapshot.lastAlertId);
          const effects: TimerEffect[] = [
            { type: 'PersistState', snapshot },
            {
              type: 'ShowReminder',
              title: null,
              body: null,
              timerGeneration: snapshot.timerGeneration,
              alertId: activeAlertId,
            },
            {
              type: 'ScheduleAlertTimeout',
              deadlineAtMillis: deadlineAt,
              timerGeneration: snapshot.timerGeneration,
              alertId: activeAlertId,
            },
          ];
          return { newSnapshot: snapshot, effects };
        }
      }
    }
  }
}

export function calculateNextTriggerAt(now: number, config: EngineConfig): number {
  if (config.mode === 'countdown') {
    const totalMs = (config.countdownMinutes * 60 + config.countdownSeconds) * 1000;
    return now + Math.max(1000, totalMs);
  }

  let candidate: number;
  if (config.intervalMode !== 'clock') {
    candidate = now + Math.max(1, config.intervalMinutes) * 60_000;
  } else {
    const step = Math.min(90, Math.max(30, config.clockIntervalMinutes));
    const d = new Date(now);
    const currentMinute = d.getHours() * 60 + d.getMinutes();
    const nextSlot = (Math.floor(currentMinute / step) + 1) * step;
    const targetHour = Math.floor(nextSlot / 60) % 24;
    const targetMin = nextSlot % 60;

    const res = new Date(now);
    res.setHours(targetHour, targetMin, 0, 0);
    if (nextSlot >= 24 * 60 || res.getTime() <= now) {
      res.setDate(res.getDate() + 1);
    }
    candidate = res.getTime();
  }

  return adjustForQuietHoursAndActiveDays(candidate, config);
}

export function adjustForQuietHoursAndActiveDays(candidateTrigger: number, config: EngineConfig): number {
  let time = candidateTrigger;
  let iterations = 0;
  while (iterations < 14 * 24) {
    const d = new Date(time);
    const dayIndex = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const isDayActive = config.activeDays && config.activeDays[dayIndex] !== undefined ? config.activeDays[dayIndex] : true;

    if (!isDayActive) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      time = d.getTime();
      iterations++;
      continue;
    }

    if (config.quietHoursEnabled && isInQuietHoursAt(time, config.quietHoursStart, config.quietHoursEnd)) {
      const endParsed = parseTimeOfDay(config.quietHoursEnd);
      if (endParsed) {
        d.setHours(endParsed.h, endParsed.m, 0, 0);
        if (d.getTime() <= time) {
          d.setDate(d.getDate() + 1);
        }
        time = d.getTime();
        iterations++;
        continue;
      }
    }

    break;
  }
  return time;
}

export function isInQuietHoursAt(timeMillis: number, startStr: string, endStr: string): boolean {
  const d = new Date(timeMillis);
  const nowMins = d.getHours() * 60 + d.getMinutes();
  const startParsed = parseTimeOfDay(startStr);
  const endParsed = parseTimeOfDay(endStr);
  const s = startParsed ? startParsed.h * 60 + startParsed.m : 23 * 60;
  const e = endParsed ? endParsed.h * 60 + endParsed.m : 7 * 60;
  if (s < e) {
    return nowMins >= s && nowMins < e;
  } else {
    return nowMins >= s || nowMins < e;
  }
}

export function isDayActiveAt(timeMillis: number, activeDays: boolean[]): boolean {
  const d = new Date(timeMillis);
  const dayIndex = d.getDay(); // 0 = Sunday..6 = Saturday
  return activeDays && activeDays[dayIndex] !== undefined ? activeDays[dayIndex] : true;
}

export function parseTimeOfDay(timeStr: string): { h: number; m: number } | null {
  if (!timeStr) return null;
  const parts = timeStr.trim().split(':');
  if (parts.length === 2) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { h, m };
    }
  }
  return null;
}
