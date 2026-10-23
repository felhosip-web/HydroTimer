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
import { HydrationEventRepository } from '../HydrationEventRepository';
import { processTimerEffects } from '../../timer/TimerEffectProcessor';
import { getNotificationBodyForConfig } from '../../../utils/notificationUtils';

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

const fixedNow = 1_700_000_000_000;

const INITIAL_SNAPSHOT: TimerSnapshot = {
  state: 'WAITING',
  timerGeneration: 1,
  alertId: null,
  lastAlertId: 1000,
  nextTriggerAt: fixedNow,
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
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };

    const result = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, fixedNow);

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
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };

    let notificationBody = '';
    const onShowReminder = (_gen: number, _id: number, intakeMl?: number, dailyGoalMl?: number) => {
      notificationBody = `Ideje inni: ${intakeMl} ml víz. Napi cél: ${dailyGoalMl} ml.`;
    };

    const result = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, fixedNow);

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
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };

    const firstResult = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, fixedNow);
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
      timestamp: fixedNow + 5000,
    };
    const ackResult = TimerDomainEngine.processEvent(firstResult.newSnapshot, ackEvent, updatedConfig, fixedNow + 5000);

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
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };

    const initialResult = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, fixedNow);
    await processTimerEffects(initialResult.effects, { eventRepository: eventRepo });

    // App restarts/recovers while alert is active
    const recoverEvent: TimerEvent = {
      type: 'RECOVER',
      timestamp: fixedNow + 1000,
    };

    const recoverResult = TimerDomainEngine.processEvent(initialResult.newSnapshot, recoverEvent, CONFIG, fixedNow + 1000);
    await processTimerEffects(recoverResult.effects, { eventRepository: eventRepo });

    const record = await eventRepo.getById('1_1001');
    expect(record?.intakeMl).toBe(300);
    expect(record?.dailyGoalMl).toBe(3000);

    const pending = await eventRepo.listPending();
    expect(pending.length).toBe(1);
  });

  test('5. TEST_ALERT does not create a production hydration event', async () => {
    const testAlertEvent: TimerEvent = {
      type: 'TEST_ALERT',
      timestamp: fixedNow,
    };

    const result = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, testAlertEvent, CONFIG, fixedNow);
    await processTimerEffects(result.effects, { eventRepository: eventRepo });

    const pending = await eventRepo.listPending();
    expect(pending.length).toBe(0);
    expect(result.effects.some((e) => e.type === 'CreateHydrationEvent')).toBe(false);
  });

  test('6. Existing records without snapshot fields remain readable without fabricated values', async () => {
    // Persist a legacy event without intakeMl or dailyGoalMl
    const legacyEvent = {
      id: '1_999',
      timerGeneration: 1,
      alertId: 999,
      scheduledAt: fixedNow,
      createdAt: fixedNow,
      status: 'DRANK' as const,
      updatedAt: fixedNow,
    };

    await eventRepo.createIfAbsent(legacyEvent);

    const record = await eventRepo.getById('1_999');
    expect(record).not.toBeNull();
    expect(record?.intakeMl).toBeUndefined();
    expect(record?.dailyGoalMl).toBeUndefined();
  });

  test('8. DRINK action uses alert captured intakeMl snapshot rather than updated config', () => {
    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };

    const triggerResult = TimerDomainEngine.processEvent(INITIAL_SNAPSHOT, triggerEvent, CONFIG, fixedNow);
    expect(triggerResult.newSnapshot.intakeMl).toBe(300);

    // User changes config while alert is active to 500ml
    const updatedConfig: EngineConfig = {
      ...CONFIG,
      intakePerAlertMl: 500,
    };

    const drinkEvent: TimerEvent = {
      type: 'DRINK',
      timerGeneration: 1,
      alertId: 1001,
      timestamp: fixedNow + 1000,
    };

    const drinkResult = TimerDomainEngine.processEvent(triggerResult.newSnapshot, drinkEvent, updatedConfig, fixedNow + 1000);
    const drinkEffect = drinkResult.effects.find((e) => e.type === 'RecordDrink');

    expect(drinkEffect).toBeDefined();
    if (drinkEffect?.type === 'RecordDrink') {
      expect(drinkEffect.amountMl).toBe(300); // Uses captured 300ml, NOT updated 500ml
    }
  });

  test('9. Event-specific notification messaging preserves custom non-water text without 0 ml víz', () => {
    // Water
    const waterText = getNotificationBodyForConfig({ title: 'Vízivás', presetId: 'event_water', intakeMlPerAlert: 250, dailyGoalMl: 2500 }, 250, 2500);
    expect(waterText).toBe('Ideje inni: 250 ml víz. Napi cél: 2500 ml.');

    // Custom configured message on a custom reminder
    const customConfiguredMsg = getNotificationBodyForConfig({ title: 'Teázás', presetId: 'custom_1', message: 'Igyál egy csésze zöld teát!', intakeMlPerAlert: 0, dailyGoalMl: 2500 }, 0, 2500);
    expect(customConfiguredMsg).toBe('Igyál egy csésze zöld teát!');

    // Stretch
    const stretchText = getNotificationBodyForConfig({ title: 'Felállás & Nyújtás', presetId: 'event_stretch', intakeMlPerAlert: 0, dailyGoalMl: 2500 }, 0, 2500);
    expect(stretchText).toBe('Állj fel, nyújtsd át az izmaidat és mozgass meg minden ízületet!');

    // Eye
    const eyeText = getNotificationBodyForConfig({ title: '20-20-20 Szemtorna', presetId: 'event_eye', intakeMlPerAlert: 0, dailyGoalMl: 2500 }, 0, 2500);
    expect(eyeText).toBe('Nézz 20 láb (6 méter) távolságba legalább 20 másodpercig!');

    // Medicine
    const medText = getNotificationBodyForConfig({ title: 'Gyógyszer / Vitamin', presetId: 'event_medicine', intakeMlPerAlert: 0, dailyGoalMl: 2500 }, 0, 2500);
    expect(medText).toBe('Ideje bevenni az esedékes gyógyszert vagy vitamint!');

    // Walk
    const walkText = getNotificationBodyForConfig({ title: 'Séta & Friss Levegő', presetId: 'event_walk', intakeMlPerAlert: 0, dailyGoalMl: 2500 }, 0, 2500);
    expect(walkText).toBe('Tarts egy rövid sétát a friss levegőn!');

    // Focus
    const focusText = getNotificationBodyForConfig({ title: 'Fókusz & Légzés', presetId: 'event_focus', intakeMlPerAlert: 0, dailyGoalMl: 2500 }, 0, 2500);
    expect(focusText).toBe('Tarts egy rövid szünetet, vegyél mély levegőt és fókuszálj!');
  });
});
