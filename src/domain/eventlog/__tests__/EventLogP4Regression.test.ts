if (typeof globalThis.localStorage === 'undefined') {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() { return storage.size; },
  };
}

import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TimerDomainEngine } from '../../timer/TimerDomainEngine';
import { EngineConfig, TimerSnapshot, TimerEvent } from '../../timer/types';
import { HydrationEventRepository, getLocalDayBounds } from '../HydrationEventRepository';
import { createPendingHydrationEvent, HydrationEvent } from '../types';
import { processTimerEffects } from '../../timer/TimerEffectProcessor';

const DEFAULT_CONFIG: EngineConfig = {
  mode: 'interval',
  intervalMinutes: 30,
  countdownMinutes: 5,
  countdownSeconds: 0,
  alertDurationSeconds: 15,
  intervalMode: 'free',
  clockIntervalMinutes: 30,
  autoRestart: true,
  intakePerAlertMl: 250,
  dailyGoalMl: 2500,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  activeDays: [true, true, true, true, true, true, true],
};

const fixedNow = 1_700_000_000_000; // Mon Nov 14 2023 22:13:20 UTC

describe('Event Log P4 Comprehensive Cross-Platform Regression Suite (Web)', () => {
  let dbName: string;
  let eventRepo: HydrationEventRepository;

  beforeEach(() => {
    dbName = `test_db_p4_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    eventRepo = new HydrationEventRepository(dbName);
  });

  afterEach(async () => {
    try {
      await eventRepo.clear();
      eventRepo.close();
    } catch {}
  });

  // 1. Historical days
  describe('1. Historical days & date navigation boundaries', () => {
    test('Events remain strictly associated with local calendar day and do not leak to adjacent days', async () => {
      const timeZone = 'Europe/Budapest';
      // Day 1: 2026-05-10
      const day1Date = new Date('2026-05-10T12:00:00Z');
      const { startOfDay: d1Start, startOfNextDay: d1Next } = getLocalDayBounds(day1Date, timeZone);

      // Day 2: 2026-05-11
      const day2Date = new Date('2026-05-11T12:00:00Z');
      const { startOfDay: d2Start, startOfNextDay: d2Next } = getLocalDayBounds(day2Date, timeZone);

      const eventDay1End = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1001, scheduledAt: d1Next - 1000 });
      const eventDay2Start = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1002, scheduledAt: d2Start });

      await eventRepo.createIfAbsent(eventDay1End);
      await eventRepo.createIfAbsent(eventDay2Start);

      const day1List = await eventRepo.listByLocalDay(day1Date, timeZone);
      expect(day1List.length).toBe(1);
      expect(day1List[0].id).toBe('1_1001');

      const day2List = await eventRepo.listByLocalDay(day2Date, timeZone);
      expect(day2List.length).toBe(1);
      expect(day2List[0].id).toBe('1_1002');
    });

    test('Budapest DST spring forward (23h) and autumn fall back (25h) local day bounds', async () => {
      const timeZone = 'Europe/Budapest';

      // Spring forward: 2026-03-29
      const springDate = new Date('2026-03-29T12:00:00Z');
      const springBounds = getLocalDayBounds(springDate, timeZone);
      expect(springBounds.startOfNextDay - springBounds.startOfDay).toBe(23 * 3600 * 1000);

      // Autumn fall back: 2026-10-25
      const autumnDate = new Date('2026-10-25T12:00:00Z');
      const autumnBounds = getLocalDayBounds(autumnDate, timeZone);
      expect(autumnBounds.startOfNextDay - autumnBounds.startOfDay).toBe(25 * 3600 * 1000);
    });
  });

  // 2. Pending events
  describe('2. Pending events lifecycle & status resolution', () => {
    test('Unanswered alert remains PENDING across reloads and can be resolved later', async () => {
      const event = createPendingHydrationEvent({
        timerGeneration: 1,
        alertId: 1001,
        scheduledAt: fixedNow - 3600000,
        createdAt: fixedNow - 3600000,
      });
      await eventRepo.createIfAbsent(event);

      // Explicitly close repository
      eventRepo.close();

      // Reopen repo with same database
      const reloadedRepo = new HydrationEventRepository(dbName);
      const pendingList = await reloadedRepo.listPending();
      expect(pendingList.length).toBe(1);
      expect(pendingList[0].status).toBe('PENDING');

      // Resolve later
      const resolved = await reloadedRepo.updateStatus('1_1001', 'DRANK', fixedNow);
      expect(resolved.status).toBe('DRANK');

      const updatedPendingList = await reloadedRepo.listPending();
      expect(updatedPendingList.length).toBe(0);

      reloadedRepo.close();
    });
  });

  // 3. Repeated alerts and idempotency
  describe('3. Repeated alerts, duplicate-trigger idempotency, and snapshot preservation', () => {
    test('Duplicate TIMER_TRIGGER processing for same alert creates exactly one record and preserves snapshot', async () => {
      const triggerEvent: TimerEvent = {
        type: 'TIMER_TRIGGER',
        timerGeneration: 1,
        scheduledAt: fixedNow,
        timestamp: fixedNow,
      };

      const initialSnapshot: TimerSnapshot = {
        state: 'WAITING',
        timerGeneration: 1,
        alertId: null,
        lastAlertId: 1000,
        nextTriggerAt: fixedNow,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };

      // First TIMER_TRIGGER processing
      const res1 = TimerDomainEngine.processEvent(initialSnapshot, triggerEvent, DEFAULT_CONFIG, fixedNow);
      await processTimerEffects(res1.effects, { eventRepository: eventRepo });

      const record1 = await eventRepo.getById('1_1001');
      expect(record1).not.toBeNull();
      const originalCreatedAt = record1?.createdAt;
      expect(record1?.intakeMl).toBe(250);
      expect(record1?.dailyGoalMl).toBe(2500);

      // Second TIMER_TRIGGER processing for same logical alert / generation
      const duplicateTrigger: TimerEvent = {
        type: 'TIMER_TRIGGER',
        timerGeneration: 1,
        scheduledAt: fixedNow,
        timestamp: fixedNow + 500,
      };
      const res2 = TimerDomainEngine.processEvent(res1.newSnapshot, duplicateTrigger, DEFAULT_CONFIG, fixedNow + 500);
      await processTimerEffects(res2.effects, { eventRepository: eventRepo });

      // Verify exactly one record exists, ID & createdAt unchanged, snapshot preserved
      const pendingList = await eventRepo.listPending();
      expect(pendingList.length).toBe(1);

      const record2 = await eventRepo.getById('1_1001');
      expect(record2?.id).toBe('1_1001');
      expect(record2?.createdAt).toBe(originalCreatedAt);
      expect(record2?.status).toBe('PENDING');
      expect(record2?.intakeMl).toBe(250);
      expect(record2?.dailyGoalMl).toBe(2500);

      // Recovery call while alert is active
      const recoverEvent: TimerEvent = { type: 'RECOVER', timestamp: fixedNow + 1000 };
      const resRecover = TimerDomainEngine.processEvent(res2.newSnapshot, recoverEvent, DEFAULT_CONFIG, fixedNow + 1000);
      await processTimerEffects(resRecover.effects, { eventRepository: eventRepo });

      const recordAfterRecover = await eventRepo.getById('1_1001');
      expect(recordAfterRecover?.createdAt).toBe(originalCreatedAt);
      expect(recordAfterRecover?.status).toBe('PENDING');

      const allPending = await eventRepo.listPending();
      expect(allPending.length).toBe(1);
    });

    test('Direct repository createIfAbsent ignores duplicate and preserves original snapshot', async () => {
      const originalEvent = createPendingHydrationEvent({
        timerGeneration: 1,
        alertId: 1001,
        scheduledAt: fixedNow,
        createdAt: fixedNow,
        intakeMl: 250,
        dailyGoalMl: 2500,
      });

      const createdFirst = await eventRepo.createIfAbsent(originalEvent);
      expect(createdFirst.id).toBe('1_1001');
      expect(createdFirst.createdAt).toBe(fixedNow);
      expect(createdFirst.intakeMl).toBe(250);
      expect(createdFirst.dailyGoalMl).toBe(2500);

      // Attempt duplicate createIfAbsent call with same stable ID but deliberately different createdAt, intakeMl, dailyGoalMl
      const duplicateEvent: HydrationEvent = {
        id: '1_1001',
        timerGeneration: 1,
        alertId: 1001,
        scheduledAt: fixedNow,
        createdAt: fixedNow + 99999,
        status: 'PENDING',
        updatedAt: fixedNow + 99999,
        revision: 1,
        intakeMl: 999,
        dailyGoalMl: 9999,
      };

      const resultSecond = await eventRepo.createIfAbsent(duplicateEvent);

      // Assert that the returned and stored record retains original ID, createdAt, status, intakeMl, dailyGoalMl
      expect(resultSecond.id).toBe('1_1001');
      expect(resultSecond.createdAt).toBe(fixedNow);
      expect(resultSecond.status).toBe('PENDING');
      expect(resultSecond.intakeMl).toBe(250);
      expect(resultSecond.dailyGoalMl).toBe(2500);

      const fetched = await eventRepo.getById('1_1001');
      expect(fetched?.createdAt).toBe(fixedNow);
      expect(fetched?.intakeMl).toBe(250);
      expect(fetched?.dailyGoalMl).toBe(2500);
    });

    test('New legitimate alert after resolving previous alert creates distinct event', async () => {
      const initialSnapshot: TimerSnapshot = {
        state: 'WAITING',
        timerGeneration: 1,
        alertId: null,
        lastAlertId: 1000,
        nextTriggerAt: fixedNow,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };

      // First alert
      const trigger1: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, scheduledAt: fixedNow, timestamp: fixedNow };
      const res1 = TimerDomainEngine.processEvent(initialSnapshot, trigger1, DEFAULT_CONFIG, fixedNow);
      await processTimerEffects(res1.effects, { eventRepository: eventRepo });

      // User acknowledges
      const ack1: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: 1001, timestamp: fixedNow + 5000 };
      const resAck = TimerDomainEngine.processEvent(res1.newSnapshot, ack1, DEFAULT_CONFIG, fixedNow + 5000);

      // Second alert
      const nextTriggerAt = resAck.newSnapshot.nextTriggerAt!;
      const trigger2: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, scheduledAt: nextTriggerAt, timestamp: nextTriggerAt };
      const res2 = TimerDomainEngine.processEvent(resAck.newSnapshot, trigger2, DEFAULT_CONFIG, nextTriggerAt);
      await processTimerEffects(res2.effects, { eventRepository: eventRepo });

      const record1 = await eventRepo.getById('1_1001');
      const record2 = await eventRepo.getById('1_1002');
      expect(record1).not.toBeNull();
      expect(record2).not.toBeNull();
      expect(record1?.id).not.toBe(record2?.id);
    });
  });

  // 4. Timer lifecycle
  describe('4. Timer lifecycle isolation & settings changes', () => {
    test('Stopping and restarting timer increments generation so old alert cannot be associated with new generation', async () => {
      const activeSnapshot: TimerSnapshot = {
        state: 'ALERT_ACTIVE',
        timerGeneration: 1,
        alertId: 1001,
        lastAlertId: 1001,
        nextTriggerAt: fixedNow + 1800000,
        alertStartedAt: fixedNow,
        alertDeadlineAt: fixedNow + 15000,
      };

      // Stop timer
      const stopEvent: TimerEvent = { type: 'STOP', timerGeneration: 1, timestamp: fixedNow + 1000 };
      const stopRes = TimerDomainEngine.processEvent(activeSnapshot, stopEvent, DEFAULT_CONFIG, fixedNow + 1000);
      expect(stopRes.newSnapshot.state).toBe('STOPPED');

      // Start timer
      const startEvent: TimerEvent = { type: 'START', timestamp: fixedNow + 2000 };
      const startRes = TimerDomainEngine.processEvent(stopRes.newSnapshot, startEvent, DEFAULT_CONFIG, fixedNow + 2000);
      expect(startRes.newSnapshot.state).toBe('WAITING');
      expect(startRes.newSnapshot.timerGeneration).toBe(2);

      // Stale action from old generation=1, alertId=1001 received during WAITING or ALERT_ACTIVE in generation 2
      const staleAck: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: 1001, timestamp: fixedNow + 3000 };
      const staleRes = TimerDomainEngine.processEvent(startRes.newSnapshot, staleAck, DEFAULT_CONFIG, fixedNow + 3000);

      // Stale action is rejected with 0 state change
      expect(staleRes.newSnapshot.state).toBe('WAITING');
      expect(staleRes.newSnapshot.timerGeneration).toBe(2);
    });

    test('Changing timer settings before future alert affects future alert snapshot, not existing history record', async () => {
      const initialSnapshot: TimerSnapshot = {
        state: 'WAITING',
        timerGeneration: 1,
        alertId: null,
        lastAlertId: 1000,
        nextTriggerAt: fixedNow,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };

      // Alert 1 created with initial config (250ml intake, 2500ml daily goal)
      const trigger1: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, scheduledAt: fixedNow, timestamp: fixedNow };
      const res1 = TimerDomainEngine.processEvent(initialSnapshot, trigger1, DEFAULT_CONFIG, fixedNow);
      await processTimerEffects(res1.effects, { eventRepository: eventRepo });

      // User resolves alert 1
      const ack1: TimerEvent = { type: 'ACKNOWLEDGE', timerGeneration: 1, alertId: 1001, timestamp: fixedNow + 5000 };
      const resAck = TimerDomainEngine.processEvent(res1.newSnapshot, ack1, DEFAULT_CONFIG, fixedNow + 5000);

      // User updates settings to 500ml intake and 4000ml daily goal
      const updatedConfig: EngineConfig = { ...DEFAULT_CONFIG, intakePerAlertMl: 500, dailyGoalMl: 4000 };

      // Alert 2 arrives
      const nextTriggerAt = resAck.newSnapshot.nextTriggerAt!;
      const trigger2: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, scheduledAt: nextTriggerAt, timestamp: nextTriggerAt };
      const res2 = TimerDomainEngine.processEvent(resAck.newSnapshot, trigger2, updatedConfig, nextTriggerAt);
      await processTimerEffects(res2.effects, { eventRepository: eventRepo });

      // Verify earlier event retains original snapshot, later event captures new config
      const record1 = await eventRepo.getById('1_1001');
      const record2 = await eventRepo.getById('1_1002');

      expect(record1?.intakeMl).toBe(250);
      expect(record1?.dailyGoalMl).toBe(2500);

      expect(record2?.intakeMl).toBe(500);
      expect(record2?.dailyGoalMl).toBe(4000);

      // Verify recovery or repeated processing does not overwrite either snapshot
      const recoverEvent: TimerEvent = { type: 'RECOVER', timestamp: nextTriggerAt + 1000 };
      const resRecover = TimerDomainEngine.processEvent(res2.newSnapshot, recoverEvent, updatedConfig, nextTriggerAt + 1000);
      await processTimerEffects(resRecover.effects, { eventRepository: eventRepo });

      const record1AfterRecover = await eventRepo.getById('1_1001');
      const record2AfterRecover = await eventRepo.getById('1_1002');

      expect(record1AfterRecover?.intakeMl).toBe(250);
      expect(record1AfterRecover?.dailyGoalMl).toBe(2500);
      expect(record2AfterRecover?.intakeMl).toBe(500);
      expect(record2AfterRecover?.dailyGoalMl).toBe(4000);
    });
  });

  // 5. Application restart and persistence
  describe('5. Application restart, real database close/reopen, and legacy compatibility', () => {
    test('Real persistence across repository close and reopen preserves event identity, status, and snapshot', async () => {
      const event = createPendingHydrationEvent({
        timerGeneration: 1,
        alertId: 1001,
        scheduledAt: fixedNow,
        createdAt: fixedNow,
        intakeMl: 300,
        dailyGoalMl: 3000,
      });
      await eventRepo.createIfAbsent(event);
      await eventRepo.updateStatus('1_1001', 'DRANK', fixedNow + 1000);

      // Close current repository connection
      eventRepo.close();

      // Reopen repository with same database name
      const reopenedRepo = new HydrationEventRepository(dbName);
      const retrieved = await reopenedRepo.getById('1_1001');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('1_1001');
      expect(retrieved?.status).toBe('DRANK');
      expect(retrieved?.scheduledAt).toBe(fixedNow);
      expect(retrieved?.createdAt).toBe(fixedNow);
      expect(retrieved?.updatedAt).toBe(fixedNow + 1000);
      expect(retrieved?.intakeMl).toBe(300);
      expect(retrieved?.dailyGoalMl).toBe(3000);

      reopenedRepo.close();
    });

    test('Active-alert recovery after database close/reopen preserves original snapshot without duplicate records', async () => {
      const trigger1: TimerEvent = { type: 'TIMER_TRIGGER', timerGeneration: 1, scheduledAt: fixedNow, timestamp: fixedNow };
      const initialSnapshot: TimerSnapshot = {
        state: 'WAITING',
        timerGeneration: 1,
        alertId: null,
        lastAlertId: 1000,
        nextTriggerAt: fixedNow,
        alertStartedAt: null,
        alertDeadlineAt: null,
      };

      const res1 = TimerDomainEngine.processEvent(initialSnapshot, trigger1, DEFAULT_CONFIG, fixedNow);
      await processTimerEffects(res1.effects, { eventRepository: eventRepo });

      // Close repository
      eventRepo.close();

      // App restarts / reopens DB while alert is active
      const reopenedRepo = new HydrationEventRepository(dbName);

      const recoverEvent: TimerEvent = { type: 'RECOVER', timestamp: fixedNow + 2000 };
      const resRecover = TimerDomainEngine.processEvent(res1.newSnapshot, recoverEvent, DEFAULT_CONFIG, fixedNow + 2000);
      await processTimerEffects(resRecover.effects, { eventRepository: reopenedRepo });

      const pending = await reopenedRepo.listPending();
      expect(pending.length).toBe(1);

      const record = await reopenedRepo.getById('1_1001');
      expect(record?.intakeMl).toBe(250);
      expect(record?.dailyGoalMl).toBe(2500);

      reopenedRepo.close();
    });

    test('Legacy records without intakeMl / dailyGoalMl remain readable without fabricated default values', async () => {
      const legacyRaw = {
        id: '1_900',
        timerGeneration: 1,
        alertId: 900,
        scheduledAt: fixedNow,
        createdAt: fixedNow,
        status: 'DRANK' as const,
        updatedAt: fixedNow,
      };

      await eventRepo.createIfAbsent(legacyRaw as HydrationEvent);

      eventRepo.close();

      const reopenedRepo = new HydrationEventRepository(dbName);
      const retrieved = await reopenedRepo.getById('1_900');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.intakeMl).toBeUndefined();
      expect(retrieved?.dailyGoalMl).toBeUndefined();

      reopenedRepo.close();
    });
  });

  // 6. Regression boundaries
  describe('6. Regression boundaries', () => {
    test('TEST_ALERT does not create a production Event Log record', async () => {
      const snapshot: TimerSnapshot = { state: 'WAITING', timerGeneration: 1, alertId: null, lastAlertId: 1000, nextTriggerAt: fixedNow + 1800000, alertStartedAt: null, alertDeadlineAt: null };
      const testAlertEvent: TimerEvent = { type: 'TEST_ALERT', timestamp: fixedNow };

      const res = TimerDomainEngine.processEvent(snapshot, testAlertEvent, DEFAULT_CONFIG, fixedNow);
      await processTimerEffects(res.effects, { eventRepository: eventRepo });

      const pendingList = await eventRepo.listPending();
      expect(pendingList.length).toBe(0);
      const dayList = await eventRepo.listByLocalDay(new Date(fixedNow));
      expect(dayList.length).toBe(0);
    });
  });
});
