import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie, { Table } from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TimerDomainEngine } from '../../timer/TimerDomainEngine';
import { EngineConfig, TimerSnapshot, TimerEvent } from '../../timer/types';
import { HydrationEventRepository } from '../HydrationEventRepository';
import { processTimerEffects } from '../../timer/TimerEffectProcessor';

const CONFIG: EngineConfig = {
  mode: 'interval',
  intervalMinutes: 30,
  countdownMinutes: 5,
  countdownSeconds: 0,
  alertDurationSeconds: 15,
  intervalMode: 'free',
  clockIntervalMinutes: 30,
  autoRestart: true,
  intakePerAlertMl: 300,
  dailyGoalMl: 3000,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  activeDays: [true, true, true, true, true, true, true],
};

const INITIAL_SNAPSHOT: TimerSnapshot = {
  state: 'WAITING',
  timerGeneration: 1,
  alertId: null,
  lastAlertId: 1000,
  nextTriggerAt: 1000000,
  alertStartedAt: null,
  alertDeadlineAt: null,
};

describe('Event Log P3 Snapshot Unit & Integration Tests (Web)', () => {
  let dbName: string;
  let eventRepo: HydrationEventRepository;

  beforeEach(() => {
    dbName = `test_db_p3_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    eventRepo = new HydrationEventRepository(dbName);
  });

  afterEach(async () => {
    try {
      await eventRepo.clear();
      eventRepo.close();
    } catch {}
  });

  test('1. Real alert captures current intakeMl and dailyGoalMl', () => {
    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: 1000000,
      timestamp: 1000000,
    };

    const result = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, 1000000);

    expect(result.newSnapshot.intakeMl).toBe(300);
    expect(result.newSnapshot.dailyGoalMl).toBe(3000);

    const eventEffect = result.effects.find((e) => e.type === 'CreateHydrationEvent');
    expect(eventEffect).toBeDefined();
    if (eventEffect?.type === 'CreateHydrationEvent') {
      expect(eventEffect.intakeMl).toBe(300);
      expect(eventEffect.dailyGoalMl).toBe(3000);
    }

    const reminderEffect = result.effects.find((e) => e.type === 'ShowReminder');
    expect(reminderEffect).toBeDefined();
    if (reminderEffect?.type === 'ShowReminder') {
      expect(reminderEffect.intakeMl).toBe(300);
      expect(reminderEffect.dailyGoalMl).toBe(3000);
    }
  });

  test('2. Notification and persisted event use identical snapshot values', async () => {
    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: 1000000,
      timestamp: 1000000,
    };

    let notificationBody = '';
    const onShowReminder = (_gen: number, _id: number, intakeMl?: number, dailyGoalMl?: number) => {
      notificationBody = `Ideje inni: ${intakeMl} ml víz. Napi cél: ${dailyGoalMl} ml.`;
    };

    const result = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, 1000000);

    await processTimerEffects(result.effects, {
      eventRepository: eventRepo,
      onShowReminder,
    });

    const persisted = await eventRepo.getById('1_1001');
    expect(persisted).not.toBeNull();
    expect(persisted?.intakeMl).toBe(300);
    expect(persisted?.dailyGoalMl).toBe(3000);
    expect(notificationBody).toBe('Ideje inni: 300 ml víz. Napi cél: 3000 ml.');
  });

  test('3. Changing settings while timer runs affects NEXT alert, not already-triggered alert', async () => {
    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: 1000000,
      timestamp: 1000000,
    };

    const firstResult = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, 1000000);
    await processTimerEffects(firstResult.effects, { eventRepository: eventRepo });

    // User updates settings to 500ml and 4000ml goal while timer is active
    const updatedConfig: EngineConfig = {
      ...CONFIG,
      intakePerAlertMl: 500,
      dailyGoalMl: 4000,
    };

    // Active alert snapshot retains original values
    expect(firstResult.newSnapshot.intakeMl).toBe(300);
    expect(firstResult.newSnapshot.dailyGoalMl).toBe(3000);

    const activeRecord = await eventRepo.getById('1_1001');
    expect(activeRecord?.intakeMl).toBe(300);
    expect(activeRecord?.dailyGoalMl).toBe(3000);

    // User acknowledges first alert and returns to WAITING
    const ackEvent: TimerEvent = {
      type: 'ACKNOWLEDGE',
      timerGeneration: 1,
      alertId: 1001,
      timestamp: 1005000,
    };
    const ackResult = TimerDomainEngine.processEvent(firstResult.newSnapshot, ackEvent, updatedConfig, 1005000);

    // Next trigger arrives
    const nextTriggerAt = ackResult.newSnapshot.nextTriggerAt!;
    const nextTriggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: nextTriggerAt,
      timestamp: nextTriggerAt,
    };

    const secondResult = TimerDomainEngine.processEvent(ackResult.newSnapshot, nextTriggerEvent, updatedConfig, nextTriggerAt);
    await processTimerEffects(secondResult.effects, { eventRepository: eventRepo });

    expect(secondResult.newSnapshot.intakeMl).toBe(500);
    expect(secondResult.newSnapshot.dailyGoalMl).toBe(4000);

    const secondRecord = await eventRepo.getById('1_1002');
    expect(secondRecord?.intakeMl).toBe(500);
    expect(secondRecord?.dailyGoalMl).toBe(4000);
  });

  test('4. Recovery does not overwrite existing event snapshot or create duplicate events', async () => {
    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: 1000000,
      timestamp: 1000000,
    };

    const initialResult = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, 1000000);
    await processTimerEffects(initialResult.effects, { eventRepository: eventRepo });

    // App restarts/recovers while alert is active
    const recoverEvent: TimerEvent = {
      type: 'RECOVER',
      timestamp: 1001000,
    };

    const recoverResult = TimerDomainEngine.processEvent(initialResult.newSnapshot, recoverEvent, CONFIG, 1001000);
    await processTimerEffects(recoverResult.effects, { eventRepository: eventRepo });

    const record = await eventRepo.getById('1_1001');
    expect(record?.intakeMl).toBe(300);
    expect(record?.dailyGoalMl).toBe(3000);

    const allEvents = await eventRepo.listByLocalDay(new Date(1000000));
    expect(allEvents.length).toBe(1);
  });

  test('5. TEST_ALERT does not create a production hydration event', async () => {
    const testAlertEvent: TimerEvent = {
      type: 'TEST_ALERT',
      timestamp: 1000000,
    };

    const result = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, testAlertEvent, CONFIG, 1000000);
    await processTimerEffects(result.effects, { eventRepository: eventRepo });

    const allEvents = await eventRepo.listByLocalDay(new Date(1000000));
    expect(allEvents.length).toBe(0);
    expect(result.effects.some((e) => e.type === 'CreateHydrationEvent')).toBe(false);
  });

  test('6. Existing records without snapshot fields remain readable without fabricated values', async () => {
    // Persist a legacy event without intakeMl or dailyGoalMl
    const legacyEvent = {
      id: '1_999',
      timerGeneration: 1,
      alertId: 999,
      scheduledAt: 1000000,
      createdAt: 1000000,
      status: 'DRANK' as const,
      updatedAt: 1000000,
    };

    await eventRepo.createIfAbsent(legacyEvent);

    const record = await eventRepo.getById('1_999');
    expect(record).not.toBeNull();
    expect(record?.intakeMl).toBeUndefined();
    expect(record?.dailyGoalMl).toBeUndefined();
  });

  test('7. Dexie v1 -> v2 migration preserves legacy events without fabricating snapshot values', async () => {
    const migDbName = `test_mig_db_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    class LegacyDexieDb extends Dexie {
      events!: Table<any, string>;
      constructor() {
        super(migDbName);
        this.version(1).stores({
          events: 'id, scheduledAt, status, createdAt',
        });
      }
    }

    const v1Db = new LegacyDexieDb();
    await v1Db.events.add({
      id: '1_555',
      timerGeneration: 1,
      alertId: 555,
      scheduledAt: 1000000,
      createdAt: 1000000,
      status: 'DRANK',
      updatedAt: 1000000,
    });
    v1Db.close();

    const v2Repo = new HydrationEventRepository(migDbName);
    const legacyRecord = await v2Repo.getById('1_555');

    expect(legacyRecord).not.toBeNull();
    expect(legacyRecord?.status).toBe('DRANK');
    expect(legacyRecord?.intakeMl).toBeUndefined();
    expect(legacyRecord?.dailyGoalMl).toBeUndefined();

    v2Repo.close();
  });
});
