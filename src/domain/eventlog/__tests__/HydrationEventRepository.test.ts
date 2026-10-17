import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository, getLocalDayBounds } from '../HydrationEventRepository';
import {
  createPendingHydrationEvent,
} from '../types';

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

  it('6. Local-day range boundaries including Daylight Saving Time transition', async () => {
    const testDate = new Date(2025, 4, 15, 12, 0, 0); // May 15, 2025
    const { startOfDay, startOfNextDay } = getLocalDayBounds(testDate);

    // Events at boundary conditions:
    const ePrevDay = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1, scheduledAt: startOfDay - 1 });
    const eStartOfDay = createPendingHydrationEvent({ timerGeneration: 1, alertId: 2, scheduledAt: startOfDay });
    const eMidDay = createPendingHydrationEvent({ timerGeneration: 1, alertId: 3, scheduledAt: startOfDay + 12 * 3600 * 1000 });
    const eEndOfDay = createPendingHydrationEvent({ timerGeneration: 1, alertId: 4, scheduledAt: startOfNextDay - 1 });
    const eNextDay = createPendingHydrationEvent({ timerGeneration: 1, alertId: 5, scheduledAt: startOfNextDay });

    await repo.createIfAbsent(ePrevDay);
    await repo.createIfAbsent(eStartOfDay);
    await repo.createIfAbsent(eMidDay);
    await repo.createIfAbsent(eEndOfDay);
    await repo.createIfAbsent(eNextDay);

    const dayEvents = await repo.listByLocalDay(testDate);
    expect(dayEvents.length).toBe(3);
    const dayIds = dayEvents.map((e) => e.id);
    expect(dayIds).toContain('1_2');
    expect(dayIds).toContain('1_3');
    expect(dayIds).toContain('1_4');
    expect(dayIds).not.toContain('1_1');
    expect(dayIds).not.toContain('1_5');

    // DST transition date test: Spring forward (e.g. March 30, 2025)
    const dstDate = new Date(2025, 2, 30, 10, 0, 0);
    const { startOfDay: dstStart, startOfNextDay: dstNext } = getLocalDayBounds(dstDate);

    const dstEventBefore = createPendingHydrationEvent({ timerGeneration: 2, alertId: 1, scheduledAt: dstStart - 1000 });
    const dstEventDuring1 = createPendingHydrationEvent({ timerGeneration: 2, alertId: 2, scheduledAt: dstStart + 1800 * 1000 }); // 00:30
    const dstEventDuring2 = createPendingHydrationEvent({ timerGeneration: 2, alertId: 3, scheduledAt: dstNext - 1800 * 1000 }); // 23:30
    const dstEventAfter = createPendingHydrationEvent({ timerGeneration: 2, alertId: 4, scheduledAt: dstNext + 1000 });

    await repo.createIfAbsent(dstEventBefore);
    await repo.createIfAbsent(dstEventDuring1);
    await repo.createIfAbsent(dstEventDuring2);
    await repo.createIfAbsent(dstEventAfter);

    const dstEvents = await repo.listByLocalDay(dstDate);
    expect(dstEvents.length).toBe(2);
    const dstIds = dstEvents.map((e) => e.id);
    expect(dstIds).toContain('2_2');
    expect(dstIds).toContain('2_3');
    expect(dstIds).not.toContain('2_1');
    expect(dstIds).not.toContain('2_4');
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
});
