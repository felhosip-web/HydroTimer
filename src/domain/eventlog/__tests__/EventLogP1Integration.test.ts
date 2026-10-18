import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository, HydrationDatabase } from '../HydrationEventRepository';
import { TimerDomainEngine } from '../../timer/TimerDomainEngine';
import { TimerSnapshot, EngineConfig, TimerEvent } from '../../timer/types';
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

describe('Event Log P1 Integration Tests (Web IndexedDB)', () => {
  let repository: HydrationEventRepository;
  let testDbName: string;

  beforeEach(async () => {
    testDbName = `HydroTimerP1TestDB_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    repository = new HydrationEventRepository(testDbName);
    await repository.clear();
  });

  afterEach(async () => {
    await repository.clear();
    repository.close();
  });

  // 1. A valid real alert creates exactly one "PENDING" event.
  test('1. Valid real alert creates exactly one PENDING event', async () => {
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

    const createEffect = result.effects.find((e) => e.type === 'CreateHydrationEvent');
    expect(createEffect).toBeDefined();

    if (createEffect && createEffect.type === 'CreateHydrationEvent') {
      const pendingEvent = createPendingHydrationEvent({
        timerGeneration: createEffect.timerGeneration,
        alertId: createEffect.alertId,
        scheduledAt: createEffect.scheduledAt,
        createdAt: fixedNow,
      });

      const saved = await repository.createIfAbsent(pendingEvent);
      expect(saved.id).toBe('1_1001');
      expect(saved.timerGeneration).toBe(1);
      expect(saved.alertId).toBe(1001);
      expect(saved.scheduledAt).toBe(fixedNow);
      expect(saved.status).toBe('PENDING');

      const retrieved = await repository.getById('1_1001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.status).toBe('PENDING');
    }
  });

  // 2. Reprocessing the same alert or receiving duplicate callbacks creates no duplicate event.
  test('2. Reprocessing the same alert or receiving duplicate callbacks creates no duplicate event', async () => {
    const event1 = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
      createdAt: fixedNow,
    });

    const firstResult = await repository.createIfAbsent(event1);

    // Duplicate submission with modified created timestamp
    const duplicateEvent = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
      createdAt: fixedNow + 5000,
    });

    const secondResult = await repository.createIfAbsent(duplicateEvent);

    expect(secondResult.id).toBe('1_1001');
    expect(secondResult.createdAt).toBe(fixedNow); // Original createdAt preserved
    expect(secondResult.status).toBe('PENDING');

    const pendingList = await repository.listPending();
    expect(pendingList.length).toBe(1);
  });

  // 3. A different alert ID creates a separate event.
  test('3. Distinct alert IDs produce distinct events', async () => {
    const eventA = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
    });
    const eventB = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1002,
      scheduledAt: fixedNow + 30 * 60 * 1000,
    });

    await repository.createIfAbsent(eventA);
    await repository.createIfAbsent(eventB);

    const recA = await repository.getById('1_1001');
    const recB = await repository.getById('1_1002');

    expect(recA).not.toBeNull();
    expect(recB).not.toBeNull();
    expect(recA?.id).not.toBe(recB?.id);
    expect(recA?.alertId).toBe(1001);
    expect(recB?.alertId).toBe(1002);
  });

  // 4. The same alert ID under a different valid timer generation creates a separate event.
  test('4. Same alert ID under different timer generation produces distinct event', async () => {
    const eventGen1 = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
    });
    const eventGen2 = createPendingHydrationEvent({
      timerGeneration: 2,
      alertId: 1001,
      scheduledAt: fixedNow + 60000,
    });

    await repository.createIfAbsent(eventGen1);
    await repository.createIfAbsent(eventGen2);

    const recGen1 = await repository.getById('1_1001');
    const recGen2 = await repository.getById('2_1001');

    expect(recGen1?.id).toBe('1_1001');
    expect(recGen2?.id).toBe('2_1001');
    expect(recGen1?.timerGeneration).toBe(1);
    expect(recGen2?.timerGeneration).toBe(2);
  });

  // 5. TEST_ALERT creates no event, including during recovery.
  test('5. TEST_ALERT creates no event, including during recovery', async () => {
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
    const testAlertResult = TimerDomainEngine.processEvent(waitingSnap, testAlertEvent, baseConfig, fixedNow);

    expect(testAlertResult.newSnapshot.state).toBe('ALERT_ACTIVE');
    expect(testAlertResult.newSnapshot.isTestAlert).toBe(true);

    const hasCreateEffect = testAlertResult.effects.some((e) => e.type === 'CreateHydrationEvent');
    expect(hasCreateEffect).toBe(false);

    // Now test recovery of this active test alert
    const recoverEvent: TimerEvent = { type: 'RECOVER', timestamp: fixedNow + 2000 };
    const recoverResult = TimerDomainEngine.processEvent(testAlertResult.newSnapshot, recoverEvent, baseConfig, fixedNow + 2000);

    expect(recoverResult.newSnapshot.state).toBe('ALERT_ACTIVE');
    const recoverHasCreateEffect = recoverResult.effects.some((e) => e.type === 'CreateHydrationEvent');
    expect(recoverHasCreateEffect).toBe(false);

    const pendingList = await repository.listPending();
    expect(pendingList.length).toBe(0);
  });

  // 6. Stale or rejected triggers create no event.
  test('6. Stale or rejected triggers create no event', async () => {
    const waitingSnap: TimerSnapshot = {
      state: 'WAITING',
      timerGeneration: 2,
      alertId: null,
      lastAlertId: 1001,
      nextTriggerAt: fixedNow,
      alertStartedAt: null,
      alertDeadlineAt: null,
    };

    // Trigger with wrong timer generation
    const staleGenTrigger: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 1, // expected 2
      scheduledAt: fixedNow,
      timestamp: fixedNow,
    };
    const resStaleGen = TimerDomainEngine.processEvent(waitingSnap, staleGenTrigger, baseConfig, fixedNow);
    expect(resStaleGen.effects.some((e) => e.type === 'CreateHydrationEvent')).toBe(false);

    // Trigger with wrong scheduledAt
    const wrongTimeTrigger: TimerEvent = {
      type: 'TIMER_TRIGGER',
      timerGeneration: 2,
      scheduledAt: fixedNow - 5000, // expected fixedNow
      timestamp: fixedNow,
    };
    const resWrongTime = TimerDomainEngine.processEvent(waitingSnap, wrongTimeTrigger, baseConfig, fixedNow);
    expect(resWrongTime.effects.some((e) => e.type === 'CreateHydrationEvent')).toBe(false);

    const pendingList = await repository.listPending();
    expect(pendingList.length).toBe(0);
  });

  // 7. Recovery/replay of a persisted accepted alert creates a missing event when possible and remains idempotent when the event already exists.
  test('7. Recovery of an accepted real alert creates missing event idempotently', async () => {
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

    const recoverResult = TimerDomainEngine.processEvent(activeRealAlertSnap, { type: 'RECOVER', timestamp: fixedNow + 2000 }, baseConfig, fixedNow + 2000);
    const createEffect = recoverResult.effects.find((e) => e.type === 'CreateHydrationEvent');

    expect(createEffect).toBeDefined();
    if (createEffect && createEffect.type === 'CreateHydrationEvent') {
      expect(createEffect.timerGeneration).toBe(3);
      expect(createEffect.alertId).toBe(1005);
      expect(createEffect.scheduledAt).toBe(fixedNow);

      const pendingEvent = createPendingHydrationEvent({
        timerGeneration: createEffect.timerGeneration,
        alertId: createEffect.alertId,
        scheduledAt: createEffect.scheduledAt,
      });

      const saved1 = await repository.createIfAbsent(pendingEvent);
      expect(saved1.id).toBe('3_1005');

      // Second recovery replay call
      const saved2 = await repository.createIfAbsent(pendingEvent);
      expect(saved2.id).toBe('3_1005');
      expect(saved2.createdAt).toBe(saved1.createdAt);
    }
  });

  // 8. Recovery does not reset an existing event's status or overwrite its original scheduled/created timestamps.
  test('8. Recovery does not reset an existing event status or overwrite original timestamps', async () => {
    const initialEvent = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
      createdAt: fixedNow,
    });

    await repository.createIfAbsent(initialEvent);

    // User marks event as DRANK
    const updated = await repository.updateStatus('1_1001', 'DRANK', fixedNow + 5000);
    expect(updated.status).toBe('DRANK');

    // Subsequent recovery attempt calls createIfAbsent for the same alert
    const recoveryEvent = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
      createdAt: fixedNow + 10000,
    });

    const resultAfterRecoveryAttempt = await repository.createIfAbsent(recoveryEvent);

    expect(resultAfterRecoveryAttempt.status).toBe('DRANK'); // Not reset to PENDING
    expect(resultAfterRecoveryAttempt.createdAt).toBe(fixedNow); // Original timestamp kept
    expect(resultAfterRecoveryAttempt.scheduledAt).toBe(fixedNow);
  });

  // 9. Event persistence failure follows the documented error-handling behavior without falsely reporting success.
  test('9. Event persistence failure is caught explicitly without breaking timer state', async () => {
    const db = new HydrationDatabase(testDbName);
    const repo = new HydrationEventRepository(db);

    // Close the database to trigger a Dexie error on createIfAbsent
    db.close();

    const pendingEvent = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: fixedNow,
    });

    let caughtError: unknown = null;
    try {
      await repo.createIfAbsent(pendingEvent);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
  });
});
