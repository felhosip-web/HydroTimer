import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

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

// @ts-ignore
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository } from '../HydrationEventRepository';
import { TimerDomainEngine } from '../../timer/TimerDomainEngine';
import { TimerSnapshot, EngineConfig, TimerEvent } from '../../timer/types';
import { processTimerEffects } from '../../timer/TimerEffectProcessor';
import { createPendingHydrationEvent } from '../types';

const baseConfig: EngineConfig = {
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

const fixedNow = 1_700_000_000_000;

describe('Event Log P1 Integration Tests (Web Effect Boundary & Dexie)', () => {
  let repository: HydrationEventRepository;
  let testDbName: string;

  beforeEach(() => {
    testDbName = `HydroTimerP1TestDB_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    repository = new HydrationEventRepository(testDbName);
  });

  afterEach(async () => {
    try {
      await repository.clear();
      repository.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  // 1. Production effect execution path creates PENDING event for real alert.
  test('1. Effect execution path persists PENDING event for real alert', async () => {
    const waitingSnap: TimerSnapshot = {
      state: 'WAITING',
      timerGeneration: 1,
      alertId: null,
      lastAlertId: 0,
      nextTriggerAt: fixedNow,
      alertStartedAt: null,
      alertDeadlineAt: null,
    };

    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };

    const result = TimerDomainEngine.processEvent(waitingSnap, triggerEvent, baseConfig, fixedNow);
    expect(result.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(result.newSnapshot.alertId).toBe(1001);

    // Execute effects through production processor
    await processTimerEffects(result.effects, { eventRepository: repository });

    const saved = await repository.getById('1_1001');
    expect(saved).not.toBeNull();
    expect(saved?.id).toBe('1_1001');
    expect(saved?.timerGeneration).toBe(1);
    expect(saved?.alertId).toBe(1001);
    expect(saved?.scheduledAt).toBe(fixedNow);
    expect(saved?.status).toBe('PENDING');
  });

  // 2. Production effect execution path excludes TEST_ALERT.
  test('2. Effect execution path excludes TEST_ALERT', async () => {
    const waitingSnap: TimerSnapshot = {
      state: 'WAITING',
      timerGeneration: 1,
      alertId: null,
      lastAlertId: 0,
      nextTriggerAt: fixedNow + 30 * 60 * 1000,
      alertStartedAt: null,
      alertDeadlineAt: null,
    };

    const testAlertEvent: TimerEvent = { type: 'TEST_ALERT', timestamp: fixedNow };
    const result = TimerDomainEngine.processEvent(waitingSnap, testAlertEvent, baseConfig, fixedNow);

    expect(result.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(result.newSnapshot.isTestAlert).toBe(true);

    // Execute effects through production processor
    await processTimerEffects(result.effects, { eventRepository: repository });

    const pendingList = await repository.listPending();
    expect(pendingList.length).toBe(0);
  });

  // 3. Recovery through production effect execution path creates missing event idempotently.
  test('3. Recovery through effect execution path recovers missing real alert idempotently', async () => {
    const activeRealAlertSnap: TimerSnapshot = {
      state: 'ALERT_ACTIVE',
      timerGeneration: 3,
      alertId: 1005,
      lastAlertId: 1005,
      nextTriggerAt: fixedNow + 30 * 60 * 1000,
      alertStartedAt: fixedNow,
      alertDeadlineAt: fixedNow + 15000,
      alertScheduledAt: fixedNow,
      isTestAlert: false,
    };

    const recoverResult1 = TimerDomainEngine.processEvent(activeRealAlertSnap, { type: 'RECOVER', timestamp: fixedNow + 2000 }, baseConfig, fixedNow + 2000);
    await processTimerEffects(recoverResult1.effects, { eventRepository: repository });

    const saved1 = await repository.getById('3_1005');
    expect(saved1).not.toBeNull();
    expect(saved1?.status).toBe('PENDING');

    // Repeated recovery call
    const recoverResult2 = TimerDomainEngine.processEvent(recoverResult1.newSnapshot, { type: 'RECOVER', timestamp: fixedNow + 3000 }, baseConfig, fixedNow + 3000);
    await processTimerEffects(recoverResult2.effects, { eventRepository: repository });

    const saved2 = await repository.getById('3_1005');
    expect(saved2?.createdAt).toBe(saved1?.createdAt);

    const pendingList = await repository.listPending();
    expect(pendingList.length).toBe(1);
  });

  // 4. Recovery through production effect execution path preserves existing event status and timestamps.
  test('4. Recovery through effect execution path preserves existing status and timestamps', async () => {
    const initialEvent = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
      createdAt: fixedNow,
    });
    await repository.createIfAbsent(initialEvent);
    await repository.updateStatus('1_1001', 'DRANK', fixedNow + 5000);

    const activeSnap: TimerSnapshot = {
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      lastAlertId: 1001,
      nextTriggerAt: fixedNow + 30 * 60 * 1000,
      alertStartedAt: fixedNow,
      alertDeadlineAt: fixedNow + 15000,
      alertScheduledAt: fixedNow,
      isTestAlert: false,
    };

    const recoverResult = TimerDomainEngine.processEvent(activeSnap, { type: 'RECOVER', timestamp: fixedNow + 6000 }, baseConfig, fixedNow + 6000);
    await processTimerEffects(recoverResult.effects, { eventRepository: repository });

    const finalEvent = await repository.getById('1_1001');
    expect(finalEvent?.status).toBe('DRANK'); // Not reset to PENDING
    expect(finalEvent?.createdAt).toBe(fixedNow);
    expect(finalEvent?.scheduledAt).toBe(fixedNow);
  });

  // 5. Recovery of test alert creates no event.
  test('5. Recovery of test alert creates no event', async () => {
    const testAlertSnap: TimerSnapshot = {
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      lastAlertId: 1001,
      nextTriggerAt: fixedNow + 30 * 60 * 1000,
      alertStartedAt: fixedNow,
      alertDeadlineAt: fixedNow + 15000,
      alertScheduledAt: null,
      isTestAlert: true,
    };

    const recoverResult = TimerDomainEngine.processEvent(testAlertSnap, { type: 'RECOVER', timestamp: fixedNow + 2000 }, baseConfig, fixedNow + 2000);
    await processTimerEffects(recoverResult.effects, { eventRepository: repository });

    const pendingList = await repository.listPending();
    expect(pendingList.length).toBe(0);
  });

  // 6. Repository failure at effect execution boundary is caught and observable without throwing or breaking state transitions.
  test('6. Repository failure during effect processing is caught explicitly', async () => {
    const failingRepo = {
      createIfAbsent: async () => {
        throw new Error('Database / Storage failure');
      },
    } as unknown as HydrationEventRepository;

    const waitingSnap: TimerSnapshot = {
      state: 'WAITING',
      timerGeneration: 1,
      alertId: null,
      lastAlertId: 0,
      nextTriggerAt: fixedNow,
      alertStartedAt: null,
      alertDeadlineAt: null,
    };

    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };

    const result = TimerDomainEngine.processEvent(waitingSnap, triggerEvent, baseConfig, fixedNow);
    expect(result.newSnapshot.state).toBe('ALERT_ACTIVE');

    // Executing effects on a failing repository must not throw or crash
    await expect(processTimerEffects(result.effects, { eventRepository: failingRepo })).resolves.toBeUndefined();
  });

  // 7. Delayed trigger preserves authoritative scheduledAt during creation and recovery.
  test('7. Delayed trigger preserves authoritative scheduledAt during creation and recovery', async () => {
    const scheduledTime = fixedNow;
    const delayedActivationTime = fixedNow + 5000; // Callback delayed by 5s

    const waitingSnap: TimerSnapshot = {
      state: 'WAITING',
      timerGeneration: 1,
      alertId: null,
      lastAlertId: 0,
      nextTriggerAt: scheduledTime,
      alertStartedAt: null,
      alertDeadlineAt: null,
    };

    const triggerEvent: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1,
      scheduledAt: scheduledTime,
      timestamp: delayedActivationTime,
    };

    const result = TimerDomainEngine.processEvent(waitingSnap, triggerEvent, baseConfig, delayedActivationTime);
    expect(result.newSnapshot.alertStartedAt).toBe(delayedActivationTime);
    expect(result.newSnapshot.alertScheduledAt).toBe(scheduledTime);

    await processTimerEffects(result.effects, { eventRepository: repository });

    const saved = await repository.getById('1_1001');
    expect(saved?.scheduledAt).toBe(scheduledTime); // Must be original scheduledTime, NOT delayedActivationTime

    // Clear repository to test recovery of missing event
    await repository.clear();

    const recoverResult = TimerDomainEngine.processEvent(result.newSnapshot, { type: 'RECOVER', timestamp: delayedActivationTime + 2000 }, baseConfig, delayedActivationTime + 2000);
    await processTimerEffects(recoverResult.effects, { eventRepository: repository });

    const recovered = await repository.getById('1_1001');
    expect(recovered?.scheduledAt).toBe(scheduledTime); // Still original scheduledTime
  });

  // 8. Legacy active alert snapshot without alertScheduledAt safely skips event creation without fabricating timestamps.
  test('8. Legacy active alert snapshot without alertScheduledAt skips event creation', async () => {
    const legacySnap: TimerSnapshot = {
      state: 'ALERT_ACTIVE',
      timerGeneration: 1,
      alertId: 1001,
      lastAlertId: 1001,
      nextTriggerAt: fixedNow + 30 * 60 * 1000,
      alertStartedAt: fixedNow,
      alertDeadlineAt: fixedNow + 15000,
      // alertScheduledAt is undefined (legacy format)
      isTestAlert: false,
    };

    const recoverResult = TimerDomainEngine.processEvent(legacySnap, { type: 'RECOVER', timestamp: fixedNow + 2000 }, baseConfig, fixedNow + 2000);
    await processTimerEffects(recoverResult.effects, { eventRepository: repository });

    const pendingList = await repository.listPending();
    expect(pendingList.length).toBe(0); // Safely skipped, no fake event fabricated
  });
});
