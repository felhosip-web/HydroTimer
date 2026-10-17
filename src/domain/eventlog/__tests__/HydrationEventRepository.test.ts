import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository, getLocalDayBounds } from '../HydrationEventRepository';
import { createPendingHydrationEvent } from '../types';

describe('HydrationEventRepository Unit Tests (IndexedDB)', () => {
  let dbName: string;
  let repo: HydrationEventRepository;

  beforeEach(() => {
    dbName = `test_db_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    repo = new HydrationEventRepository(dbName);
  });

  afterEach(async () => {
    try {
      await repo.clear();
      repo.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  it('1. Valid creation of a PENDING event', async () => {
    const scheduledAt = 1710000000000;
    const createdAt = 1710000000000;
    const pendingEvent = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt,
      createdAt,
    });

    const created = await repo.createIfAbsent(pendingEvent);

    expect(created.id).toBe('1_1001');
    expect(created.timerGeneration).toBe(1);
    expect(created.alertId).toBe(1001);
    expect(created.scheduledAt).toBe(scheduledAt);
    expect(created.createdAt).toBe(createdAt);
    expect(created.status).toBe('PENDING');
    expect(created.updatedAt).toBe(createdAt);
    expect(created.revision).toBe(1);

    const fetched = await repo.getById('1_1001');
    expect(fetched).not.toBeNull();
    expect(fetched?.status).toBe('PENDING');
  });

  it('2. Duplicate creation of the same event is idempotent', async () => {
    const event1 = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: 1710000000000,
      createdAt: 1710000000000,
    });

    await repo.createIfAbsent(event1);

    // Modify status of stored event
    await repo.updateStatus('1_1001', 'DRANK', 1710000005000);

    // Attempt duplicate creation with same (gen=1, alert=1001) but different scheduledAt
    const duplicateEvent = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: 1710000999999,
      createdAt: 1710000000000,
    });

    const secondResult = await repo.createIfAbsent(duplicateEvent);

    // Should return existing event without overwriting
    expect(secondResult.id).toBe('1_1001');
    expect(secondResult.status).toBe('DRANK');

    const allPending = await repo.listPending();
    expect(allPending.length).toBe(0);
  });

  it('3. Distinct events created for distinct trigger identities', async () => {
    const event1 = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: 1710000000000,
    });
    const event2 = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1002,
      scheduledAt: 1710003600000,
    });
    const event3 = createPendingHydrationEvent({
      timerGeneration: 2,
      alertId: 1001,
      scheduledAt: 1710007200000,
    });

    await repo.createIfAbsent(event1);
    await repo.createIfAbsent(event2);
    await repo.createIfAbsent(event3);

    const e1 = await repo.getById('1_1001');
    const e2 = await repo.getById('1_1002');
    const e3 = await repo.getById('2_1001');

    expect(e1?.id).toBe('1_1001');
    expect(e2?.id).toBe('1_1002');
    expect(e3?.id).toBe('2_1001');

    const pendingList = await repo.listPending();
    expect(pendingList.length).toBe(3);
  });

  it('4. Status updates and updatedAt handling', async () => {
    const event = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: 1710000000000,
      createdAt: 1710000000000,
    });
    await repo.createIfAbsent(event);

    const updatedDrank = await repo.updateStatus('1_1001', 'DRANK', 1710000010000);
    expect(updatedDrank.status).toBe('DRANK');
    expect(updatedDrank.updatedAt).toBe(1710000010000);
    expect(updatedDrank.revision).toBe(2);

    const updatedNotDrank = await repo.updateStatus('1_1001', 'NOT_DRANK', 1710000020000);
    expect(updatedNotDrank.status).toBe('NOT_DRANK');
    expect(updatedNotDrank.updatedAt).toBe(1710000020000);
    expect(updatedNotDrank.revision).toBe(3);

    const updatedRejected = await repo.updateStatus('1_1001', 'REJECTED', 1710000030000);
    expect(updatedRejected.status).toBe('REJECTED');
    expect(updatedRejected.updatedAt).toBe(1710000030000);
    expect(updatedRejected.revision).toBe(4);
  });

  it('5. Pending-event queries return only PENDING status events', async () => {
    await repo.createIfAbsent(
      createPendingHydrationEvent({ timerGeneration: 1, alertId: 1001, scheduledAt: 1000 })
    );
    await repo.createIfAbsent(
      createPendingHydrationEvent({ timerGeneration: 1, alertId: 1002, scheduledAt: 2000 })
    );
    await repo.createIfAbsent(
      createPendingHydrationEvent({ timerGeneration: 1, alertId: 1003, scheduledAt: 3000 })
    );

    await repo.updateStatus('1_1002', 'DRANK', 2500);

    const pendingList = await repo.listPending();
    expect(pendingList.length).toBe(2);
    const pendingIds = pendingList.map((e) => e.id);
    expect(pendingIds).toContain('1_1001');
    expect(pendingIds).toContain('1_1003');
    expect(pendingIds).not.toContain('1_1002');
  });

  it('6. Deterministic DST spring forward (23h) and autumn fall back (25h) local day boundary test', async () => {
    const budapest = 'Europe/Budapest';

    // 1. Spring forward transition: March 30, 2025
    const springDate = new Date('2025-03-30T12:00:00Z');
    const { startOfDay: springStart, startOfNextDay: springNext } = getLocalDayBounds(springDate, budapest);
    const springDurationMs = springNext - springStart;

    expect(springDurationMs).toBe(23 * 3600 * 1000); // Exactly 23 hours

    const eSpringBefore = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1, scheduledAt: springStart - 1 });
    const eSpringStart = createPendingHydrationEvent({ timerGeneration: 1, alertId: 2, scheduledAt: springStart });
    const eSpringMid = createPendingHydrationEvent({ timerGeneration: 1, alertId: 3, scheduledAt: springStart + 12 * 3600 * 1000 });
    const eSpringEnd = createPendingHydrationEvent({ timerGeneration: 1, alertId: 4, scheduledAt: springNext - 1 });
    const eSpringNext = createPendingHydrationEvent({ timerGeneration: 1, alertId: 5, scheduledAt: springNext });

    await repo.createIfAbsent(eSpringBefore);
    await repo.createIfAbsent(eSpringStart);
    await repo.createIfAbsent(eSpringMid);
    await repo.createIfAbsent(eSpringEnd);
    await repo.createIfAbsent(eSpringNext);

    const springEvents = await repo.listByLocalDay(springDate, budapest);
    expect(springEvents.length).toBe(3);
    const springIds = springEvents.map((e) => e.id);
    expect(springIds).toContain('1_2');
    expect(springIds).toContain('1_3');
    expect(springIds).toContain('1_4');
    expect(springIds).not.toContain('1_1');
    expect(springIds).not.toContain('1_5');

    await repo.clear();

    // 2. Autumn fall back transition: October 26, 2025
    const autumnDate = new Date('2025-10-26T12:00:00Z');
    const { startOfDay: autumnStart, startOfNextDay: autumnNext } = getLocalDayBounds(autumnDate, budapest);
    const autumnDurationMs = autumnNext - autumnStart;

    expect(autumnDurationMs).toBe(25 * 3600 * 1000); // Exactly 25 hours

    const eAutumnBefore = createPendingHydrationEvent({ timerGeneration: 2, alertId: 1, scheduledAt: autumnStart - 1 });
    const eAutumnStart = createPendingHydrationEvent({ timerGeneration: 2, alertId: 2, scheduledAt: autumnStart });
    const eAutumnMid = createPendingHydrationEvent({ timerGeneration: 2, alertId: 3, scheduledAt: autumnStart + 12 * 3600 * 1000 });
    const eAutumnEnd = createPendingHydrationEvent({ timerGeneration: 2, alertId: 4, scheduledAt: autumnNext - 1 });
    const eAutumnNext = createPendingHydrationEvent({ timerGeneration: 2, alertId: 5, scheduledAt: autumnNext });

    await repo.createIfAbsent(eAutumnBefore);
    await repo.createIfAbsent(eAutumnStart);
    await repo.createIfAbsent(eAutumnMid);
    await repo.createIfAbsent(eAutumnEnd);
    await repo.createIfAbsent(eAutumnNext);

    const autumnEvents = await repo.listByLocalDay(autumnDate, budapest);
    expect(autumnEvents.length).toBe(3);
    const autumnIds = autumnEvents.map((e) => e.id);
    expect(autumnIds).toContain('2_2');
    expect(autumnIds).toContain('2_3');
    expect(autumnIds).toContain('2_4');
    expect(autumnIds).not.toContain('2_1');
    expect(autumnIds).not.toContain('2_5');
  });

  it('7. Persistence across repository/database reinitialization', async () => {
    const event = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: 1710000000000,
    });
    await repo.createIfAbsent(event);
    await repo.updateStatus('1_1001', 'DRANK', 1710000005000);

    // Instantiate a new repo instance accessing the same underlying database
    const repo2 = new HydrationEventRepository(dbName);
    const fetched = await repo2.getById('1_1001');

    expect(fetched).not.toBeNull();
    expect(fetched?.status).toBe('DRANK');
    expect(fetched?.updatedAt).toBe(1710000005000);

    repo2.close();
  });

  it('8. Database or storage failures are reported to the caller', async () => {
    // Updating non-existent ID throws
    await expect(repo.updateStatus('non_existent_id', 'DRANK')).rejects.toThrow();

    // Operations after DB connection is closed reject
    repo.close();
    const event = createPendingHydrationEvent({ timerGeneration: 1, alertId: 9999, scheduledAt: 1000 });
    await expect(repo.createIfAbsent(event)).rejects.toThrow();
  });

  it('9. No automatic status transition when an event is left unanswered', async () => {
    const pastTimestamp = Date.now() - 7 * 24 * 3600 * 1000; // 7 days ago
    const event = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: pastTimestamp,
      createdAt: pastTimestamp,
    });

    await repo.createIfAbsent(event);

    const fetched = await repo.getById('1_1001');
    expect(fetched?.status).toBe('PENDING');

    const pendingList = await repo.listPending();
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].status).toBe('PENDING');
  });

  it('10. Concurrent status updates are executed atomically with incrementing revisions', async () => {
    const event = createPendingHydrationEvent({
      timerGeneration: 1,
      alertId: 1001,
      scheduledAt: 1710000000000,
      createdAt: 1710000000000,
    });
    await repo.createIfAbsent(event);

    const update1 = repo.updateStatus('1_1001', 'DRANK', 1710000001000);
    const update2 = repo.updateStatus('1_1001', 'NOT_DRANK', 1710000002000);
    const update3 = repo.updateStatus('1_1001', 'REJECTED', 1710000003000);

    const [res1, res2, res3] = await Promise.all([update1, update2, update3]);

    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();
    expect(res3).not.toBeNull();

    const finalEvent = await repo.getById('1_1001');
    expect(finalEvent?.revision).toBe(4);
    expect(['DRANK', 'NOT_DRANK', 'REJECTED']).toContain(finalEvent?.status!);
  });
});
