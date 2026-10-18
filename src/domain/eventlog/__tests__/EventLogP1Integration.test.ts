import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository, HydrationDatabase } from '../HydrationEventRepository';
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
  test.only('1. Effect execution path persists PENDING event for real alert', async () => {
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
  test.only('2. Effect execution path excludes TEST_ALERT', async () => {
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
});
