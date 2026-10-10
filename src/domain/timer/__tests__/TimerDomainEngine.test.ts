// @ts-ignore
import { describe, test, expect } from 'bun:test';
import { TimerDomainEngine, calculateNextTriggerAt } from '../TimerDomainEngine';
import { TimerSnapshot, EngineConfig, TimerEvent } from '../types';

const defaultConfig: EngineConfig = {
  mode: 'interval',
  intervalMinutes: 30,
  countdownMinutes: 5,
  countdownSeconds: 0,
  alertDurationSeconds: 15,
  intervalMode: 'free',
  clockIntervalMinutes: 30,
  autoRestart: true,
  intakePerAlertMl: 250,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  activeDays: [true, true, true, true, true, true, true],
};

const defaultSnapshot: TimerSnapshot = {
  state: 'STOPPED',
  timerGeneration: 0,
  alertId: null,
  lastAlertId: 0,
  nextTriggerAt: null,
  alertStartedAt: null,
  alertDeadlineAt: null,
};

describe('TimerDomainEngine Unit Tests', () => {
  // 1. STOPPED -> START -> WAITING
  test('1. STOPPED -> START -> WAITING', () => {
    const now = 100000;
    const event: TimerEvent = { type: 'START', timestamp: now };
    const res = TimerDomainEngine.processEvent(defaultSnapshot, event, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('WAITING');
    expect(res.newSnapshot.timerGeneration).toBe(1);
    expect(res.newSnapshot.nextTriggerAt).toBe(now + 30 * 60 * 1000);
    expect(res.effects.some((e) => e.type === 'ScheduleTimer')).toBe(true);
  });

  // 2. WAITING -> TIMER_TRIGGER -> ALERT_ACTIVE
  test('2. WAITING -> TIMER_TRIGGER -> ALERT_ACTIVE', () => {
    const now = 100000;
    const waitingSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'WAITING',
      timerGeneration: 1,
      nextTriggerAt: now,
    };
    const event: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, timestamp: now };
    const res = TimerDomainEngine.processEvent(waitingSnap, event, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(res.newSnapshot.alertId).toBe(1001);
    expect(res.newSnapshot.alertStartedAt).toBe(now);
    expect(res.newSnapshot.alertDeadlineAt).toBe(now + 15000);
    expect(res.effects.some((e) => e.type === 'ScheduleAlertTimeout')).toBe(true);
  });

  // 3. ALERT_ACTIVE -> ACKNOWLEDGE
  test('3. ALERT_ACTIVE -> ACKNOWLEDGE', () => {
    const now = 100000;
    const futureTriggerAt = now + 30 * 60 * 1000 - 5000; // scheduled 5s ago when trigger fired
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 5000,
      alertDeadlineAt: now + 10000,
      nextTriggerAt: futureTriggerAt,
    };
    const event: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: 1001, timestamp: now };
    const res = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('WAITING');
    expect(res.newSnapshot.alertId).toBeNull();
    expect(res.newSnapshot.nextTriggerAt).toBe(futureTriggerAt);
    expect(res.effects.some((e) => e.type === 'RecordAck')).toBe(true);
  });

  // 3b. TIMER_TRIGGER immediately schedules next cycle and ACK keeps original trigger time
  test('3b. TIMER_TRIGGER immediately schedules next cycle and ACK keeps original trigger time', () => {
    const triggerTime = 100000;
    const waitingSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'WAITING',
      timerGeneration: 1,
      nextTriggerAt: triggerTime,
    };
    const triggerEvent: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, timestamp: triggerTime };
    const alertRes = TimerDomainEngine.processEvent(waitingSnap, triggerEvent, defaultConfig, triggerTime);

    const expectedNextTrigger = triggerTime + 30 * 60 * 1000;
    expect(alertRes.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(alertRes.newSnapshot.nextTriggerAt).toBe(expectedNextTrigger);
    expect(alertRes.effects.some((e) => e.type === 'ScheduleTimer' && e.triggerAtMillis === expectedNextTrigger)).toBe(true);

    // User acknowledges 10 seconds after trigger
    const ackTime = triggerTime + 10000;
    const ackEvent: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: alertRes.newSnapshot.alertId, timestamp: ackTime };
    const ackRes = TimerDomainEngine.processEvent(alertRes.newSnapshot, ackEvent, defaultConfig, ackTime);

    expect(ackRes.newSnapshot.state).toBe('WAITING');
    // nextTriggerAt must stay as expectedNextTrigger (from cycle trigger time), NOT calculated from ackTime!
    expect(ackRes.newSnapshot.nextTriggerAt).toBe(expectedNextTrigger);
  });

  // 3c. Missing or sentinel (-1) identifiers rejected by core state machine
  test('3c. Missing or sentinel (-1) identifiers rejected by core state machine', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 2000,
      alertDeadlineAt: now + 13000,
      nextTriggerAt: now + 30 * 60 * 1000,
    };

    // Sentinel -1 rejected
    const sentinelAck: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: -1, alertId: -1, timestamp: now };
    const resSentinel = TimerDomainEngine.processEvent(alertSnap, sentinelAck, defaultConfig, now);
    expect(resSentinel.newSnapshot).toBe(alertSnap);

    // Missing null/undefined rejected
    const missingAck: TimerEvent = { type: 'ACKNOWLEDGE', timestamp: now };
    const resMissing = TimerDomainEngine.processEvent(alertSnap, missingAck, defaultConfig, now);
    expect(resMissing.newSnapshot).toBe(alertSnap);
  });

  // 3d. Countdown mode respects autoRestart setting across ACKNOWLEDGE, DRINK, and ALERT_TIMEOUT
  test('3d. Countdown mode respects autoRestart setting', () => {
    const now = 100000;
    const countdownNoAutoConfig: EngineConfig = {
      ...defaultConfig,
      mode: 'countdown',
      countdownMinutes: 5,
      autoRestart: false,
    };
    const countdownAutoConfig: EngineConfig = {
      ...defaultConfig,
      mode: 'countdown',
      countdownMinutes: 5,
      autoRestart: true,
    };

    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 5000,
      alertDeadlineAt: now + 10000,
      nextTriggerAt: null,
    };

    // ACK with autoRestart = false -> STOPPED
    const ackNoAuto = TimerDomainEngine.processEvent(alertSnap, { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: 1001, timestamp: now }, countdownNoAutoConfig, now);
    expect(ackNoAuto.newSnapshot.state).toBe('STOPPED');

    // ACK with autoRestart = true -> WAITING
    const ackAuto = TimerDomainEngine.processEvent(alertSnap, { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: 1001, timestamp: now }, countdownAutoConfig, now);
    expect(ackAuto.newSnapshot.state).toBe('WAITING');
    expect(ackAuto.newSnapshot.nextTriggerAt).toBe(now + 5 * 60 * 1000);

    // DRINK with autoRestart = true -> WAITING
    const drinkAuto = TimerDomainEngine.processEvent(alertSnap, { type: 'DRINK', timerGeneration: 1, alertId: 1001, timestamp: now }, countdownAutoConfig, now);
    expect(drinkAuto.newSnapshot.state).toBe('WAITING');

    // TIMEOUT with autoRestart = true -> WAITING
    const timeoutAuto = TimerDomainEngine.processEvent(alertSnap, { type: 'ALERT_TIMEOUT', timerGeneration: 1, alertId: 1001, timestamp: now }, countdownAutoConfig, now);
    expect(timeoutAuto.newSnapshot.state).toBe('WAITING');
  });

  // 3e. Short interval scenario: TIMER_TRIGGER received during ALERT_ACTIVE advances nextTriggerAt
  test('3e. TIMER_TRIGGER received during ALERT_ACTIVE advances nextTriggerAt without duplicate alerts', () => {
    const startNow = 100000;
    const shortIntervalConfig: EngineConfig = {
      ...defaultConfig,
      intervalMinutes: 1, // 60s interval
      alertDurationSeconds: 120, // 120s alert window (interval < alert duration)
    };

    // First trigger at T=100000
    const waitingSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'WAITING',
      timerGeneration: 1,
      nextTriggerAt: startNow,
    };
    const res1 = TimerDomainEngine.processEvent(waitingSnap, { type: 'TIMER_TRIGGER', timerGeneration: 1, timestamp: startNow }, shortIntervalConfig, startNow);
    expect(res1.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(res1.newSnapshot.nextTriggerAt).toBe(startNow + 60000);

    // T=160000: Next interval trigger fires while state is still ALERT_ACTIVE
    const trigger2Time = startNow + 60000;
    const res2 = TimerDomainEngine.processEvent(res1.newSnapshot, { type: 'TIMER_TRIGGER', timerGeneration: 1, timestamp: trigger2Time }, shortIntervalConfig, trigger2Time);

    // Should remain in ALERT_ACTIVE, advance nextTriggerAt to startNow + 120000, and schedule timer
    expect(res2.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(res2.newSnapshot.alertId).toBe(1001); // Same alertId, no duplicate alert created
    expect(res2.newSnapshot.nextTriggerAt).toBe(trigger2Time + 60000);
    expect(res2.effects.some((e) => e.type === 'ScheduleTimer' && e.triggerAtMillis === trigger2Time + 60000)).toBe(true);
  });

  // 4. ALERT_ACTIVE -> DRINK
  test('4. ALERT_ACTIVE -> DRINK', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 5000,
      alertDeadlineAt: now + 10000,
    };
    const event: TimerEvent = { type: 'DRINK', timerGeneration: 1, alertId: 1001, timestamp: now };
    const res = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('WAITING');
    expect(res.newSnapshot.alertId).toBeNull();
    expect(res.effects.some((e) => e.type === 'RecordDrink' && e.amountMl === 250)).toBe(true);
  });

  // 5. ALERT_ACTIVE -> TIMEOUT
  test('5. ALERT_ACTIVE -> TIMEOUT', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 15000,
      alertDeadlineAt: now,
    };
    const event: TimerEvent = { type: 'ALERT_TIMEOUT', timerGeneration: 1, alertId: 1001, timestamp: now };
    const res = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('WAITING');
    expect(res.newSnapshot.alertId).toBeNull();
    expect(res.effects.some((e) => e.type === 'RecordMissed')).toBe(true);
    expect(res.effects.some((e) => e.type === 'ShowMissedNotification')).toBe(true);
  });

  // 6. stale TIMER_TRIGGER ignored
  test('6. stale TIMER_TRIGGER ignored', () => {
    const now = 100000;
    const waitingSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'WAITING',
      timerGeneration: 2,
      nextTriggerAt: now + 10000,
    };
    const event: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, timestamp: now };
    const res = TimerDomainEngine.processEvent(waitingSnap, event, defaultConfig, now);

    expect(res.newSnapshot).toBe(waitingSnap);
    expect(res.effects.length).toBe(0);
  });

  // 7. stale ACK ignored
  test('7. stale ACK ignored', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 2,
      alertId: 1002,
    };
    const event: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: 2, alertId: 1001, timestamp: now };
    const res = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    expect(res.newSnapshot).toBe(alertSnap);
    expect(res.effects.length).toBe(0);
  });

  // 8. stale DRINK ignored
  test('8. stale DRINK ignored', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 2,
      alertId: 1002,
    };
    const event: TimerEvent = { type: 'DRINK', timerGeneration: 1, alertId: 1002, timestamp: now };
    const res = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    expect(res.newSnapshot).toBe(alertSnap);
    expect(res.effects.length).toBe(0);
  });

  // 9. stale TIMEOUT ignored
  test('9. stale TIMEOUT ignored', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 2,
      alertId: 1002,
    };
    const event: TimerEvent = { type: 'ALERT_TIMEOUT', timerGeneration: 2, alertId: 1001, timestamp: now };
    const res = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    expect(res.newSnapshot).toBe(alertSnap);
    expect(res.effects.length).toBe(0);
  });

  // 10. duplicate ACK idempotent
  test('10. duplicate ACK idempotent', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 5000,
      alertDeadlineAt: now + 10000,
    };
    const event: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: 1001, timestamp: now };
    const res1 = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    // Second duplicate ACK on already transitioned WAITING snapshot
    const res2 = TimerDomainEngine.processEvent(res1.newSnapshot, event, defaultConfig, now);
    expect(res2.newSnapshot).toBe(res1.newSnapshot);
    expect(res2.effects.length).toBe(0);
  });

  // 11. duplicate DRINK idempotent
  test('11. duplicate DRINK idempotent', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
    };
    const event: TimerEvent = { type: 'DRINK', timerGeneration: 1, alertId: 1001, timestamp: now };
    const res1 = TimerDomainEngine.processEvent(alertSnap, event, defaultConfig, now);

    const res2 = TimerDomainEngine.processEvent(res1.newSnapshot, event, defaultConfig, now);
    expect(res2.newSnapshot).toBe(res1.newSnapshot);
    expect(res2.effects.length).toBe(0);
  });

  // 12. STOP -> START -> old callback ignored
  test('12. STOP -> START -> old callback ignored', () => {
    const now = 100000;
    const snap1: TimerSnapshot = { ...defaultSnapshot, state: 'WAITING', timerGeneration: 1 };
    const stopEvent: TimerEvent = { type: 'STOP', timerGeneration: 1, timestamp: now };
    const resStop = TimerDomainEngine.processEvent(snap1, stopEvent, defaultConfig, now);

    const startEvent: TimerEvent = { type: 'START', timestamp: now + 1000 };
    const resStart = TimerDomainEngine.processEvent(resStop.newSnapshot, startEvent, defaultConfig, now + 1000);
    expect(resStart.newSnapshot.timerGeneration).toBe(2);

    // Callback from generation 1 arrives
    const oldTrigger: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, timestamp: now + 2000 };
    const resOld = TimerDomainEngine.processEvent(resStart.newSnapshot, oldTrigger, defaultConfig, now + 2000);
    expect(resOld.newSnapshot).toBe(resStart.newSnapshot);
    expect(resOld.effects.length).toBe(0);
  });

  // 13. reload/recovery future WAITING
  test('13. reload/recovery future WAITING', () => {
    const now = 100000;
    const futureSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'WAITING',
      timerGeneration: 1,
      nextTriggerAt: now + 50000,
    };
    const recoverEvent: TimerEvent = { type: 'RECOVER', timestamp: now };
    const res = TimerDomainEngine.processEvent(futureSnap, recoverEvent, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('WAITING');
    expect(res.effects.some((e) => e.type === 'ScheduleTimer' && e.triggerAtMillis === now + 50000)).toBe(true);
  });

  // 14. reload/recovery active ALERT
  test('14. reload/recovery active ALERT', () => {
    const now = 100000;
    const activeAlertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 5000,
      alertDeadlineAt: now + 10000,
    };
    const recoverEvent: TimerEvent = { type: 'RECOVER', timestamp: now };
    const res = TimerDomainEngine.processEvent(activeAlertSnap, recoverEvent, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(res.effects.some((e) => e.type === 'ScheduleAlertTimeout' && e.deadlineAtMillis === now + 10000)).toBe(true);
  });

  // 15. expired ALERT recovery
  test('15. expired ALERT recovery', () => {
    const now = 100000;
    const expiredAlertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 20000,
      alertDeadlineAt: now - 5000,
    };
    const recoverEvent: TimerEvent = { type: 'RECOVER', timestamp: now };
    const res = TimerDomainEngine.processEvent(expiredAlertSnap, recoverEvent, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('WAITING');
    expect(res.effects.some((e) => e.type === 'RecordMissed')).toBe(true);
  });

  // 16. alert deadline remains stable if config changes
  test('16. alert deadline remains stable if config changes', () => {
    const now = 100000;
    const alertSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      alertStartedAt: now - 10000,
      alertDeadlineAt: now + 5000, // original duration 15s
    };

    // User changes alert duration in config to 30s while alert is active
    const newConfig: EngineConfig = { ...defaultConfig, alertDurationSeconds: 30 };
    const timeoutEvent: TimerEvent = { type: 'ALERT_TIMEOUT', timerGeneration: 1, alertId: 1001, timestamp: now + 5000 };
    const res = TimerDomainEngine.processEvent(alertSnap, timeoutEvent, newConfig, now + 5000);

    expect(res.effects.some((e) => e.type === 'ShowMissedNotification' && e.alertDurationSeconds === 15)).toBe(true);
  });

  // 17. free interval calculation
  test('17. free interval calculation', () => {
    const now = 100000;
    const freeConfig: EngineConfig = { ...defaultConfig, intervalMode: 'free', intervalMinutes: 45 };
    const nextTrigger = calculateNextTriggerAt(now, freeConfig);

    expect(nextTrigger).toBe(now + 45 * 60 * 1000);
  });

  // 18. clock-aligned interval calculation
  test('18. clock-aligned interval calculation', () => {
    // Set fixed time 12:10 (e.g. 10 mins past hour)
    const baseDate = new Date(2026, 2, 30, 12, 10, 0, 0);
    const now = baseDate.getTime();
    const clockConfig: EngineConfig = { ...defaultConfig, intervalMode: 'clock', clockIntervalMinutes: 30 };

    const nextTrigger = calculateNextTriggerAt(now, clockConfig);
    const triggerDate = new Date(nextTrigger);

    expect(triggerDate.getHours()).toBe(12);
    expect(triggerDate.getMinutes()).toBe(30);
    expect(triggerDate.getSeconds()).toBe(0);
  });

  // 19. quiet hours
  test('19. quiet hours', () => {
    // 23:30 (inside quiet hours 23:00 - 07:00)
    const baseDate = new Date(2026, 2, 30, 23, 30, 0, 0);
    const now = baseDate.getTime();
    const quietConfig: EngineConfig = {
      ...defaultConfig,
      quietHoursEnabled: true,
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
    };

    const nextTrigger = calculateNextTriggerAt(now, quietConfig);
    const triggerDate = new Date(nextTrigger);

    expect(triggerDate.getHours()).toBe(7);
    expect(triggerDate.getMinutes()).toBe(0);
  });

  // 20. active days
  test('20. active days', () => {
    // Sunday (index 0) is inactive
    const baseDate = new Date(2026, 2, 29, 10, 0, 0, 0); // 2026-03-29 is a Sunday
    const now = baseDate.getTime();
    const activeDaysConfig: EngineConfig = {
      ...defaultConfig,
      activeDays: [false, true, true, true, true, true, true], // Sunday inactive
    };

    const nextTrigger = calculateNextTriggerAt(now, activeDaysConfig);
    const triggerDate = new Date(nextTrigger);

    // Candidate trigger on Sunday should jump to Monday 00:00
    expect(triggerDate.getDay()).toBe(1); // Monday
    expect(triggerDate.getHours()).toBe(0);
    expect(triggerDate.getMinutes()).toBe(0);
  });

  // Test A — stopped duration edit
  test('Test A — stopped duration edit keeps timer STOPPED and does not start new generation', () => {
    const now = 100000;
    const stoppedSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'STOPPED',
      timerGeneration: 5,
    };

    // Changing duration while STOPPED should not issue START or TIMER_TRIGGER events
    // Engine processEvent on non-START events when STOPPED returns same snapshot
    const dummyTrigger: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 5, timestamp: now };
    const res = TimerDomainEngine.processEvent(stoppedSnap, dummyTrigger, defaultConfig, now);

    expect(res.newSnapshot.state).toBe('STOPPED');
    expect(res.newSnapshot.timerGeneration).toBe(5);
    expect(res.effects.length).toBe(0);
  });

  // Test B — running config update uses NEW configuration for startTimer
  test('Test B — running config update uses NEW configuration for startTimer', () => {
    const now = 100000;
    const stoppedSnap: TimerSnapshot = {
      ...defaultSnapshot,
      state: 'STOPPED',
      timerGeneration: 0,
    };

    const oldConfig: EngineConfig = { ...defaultConfig, intervalMinutes: 30 };
    const newConfig: EngineConfig = { ...defaultConfig, intervalMinutes: 60 };

    // Start with old config
    const resOld = TimerDomainEngine.processEvent(stoppedSnap, { type: 'START', timestamp: now }, oldConfig, now);
    expect(resOld.newSnapshot.nextTriggerAt).toBe(now + 30 * 60 * 1000);

    // Restart with new config
    const resNew = TimerDomainEngine.processEvent(resOld.newSnapshot, { type: 'START', timestamp: now }, newConfig, now);
    expect(resNew.newSnapshot.nextTriggerAt).toBe(now + 60 * 60 * 1000);
  });
});
