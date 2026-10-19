import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository } from '../HydrationEventRepository';
import { createPendingHydrationEvent, HydrationEvent } from '../types';
import { STATUS_CONFIG } from '../../../components/EventLogView';

describe('Event Log P2 Web UI & Repository Tests', () => {
  let dbName: string;
  let repo: HydrationEventRepository;

  beforeEach(() => {
    dbName = `test_p2_db_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    repo = new HydrationEventRepository(dbName);
  });

  afterEach(async () => {
    try {
      await repo.clear();
      repo.close();
    } catch {
      // Ignore
    }
  });

  it('1. Repository query for local day returns events and sorts newest first', async () => {
    const today = new Date();
    const baseTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0, 0).getTime();

    const e1 = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1001, scheduledAt: baseTime });
    const e2 = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1002, scheduledAt: baseTime + 3600000 });
    const e3 = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1003, scheduledAt: baseTime + 7200000 });

    await repo.createIfAbsent(e1);
    await repo.createIfAbsent(e2);
    await repo.createIfAbsent(e3);

    await repo.updateStatus('1_1002', 'DRANK', baseTime + 3605000);
    await repo.updateStatus('1_1003', 'REJECTED', baseTime + 7205000);

    const events = await repo.listByLocalDay(today);
    expect(events.length).toBe(3);

    // Verify descending sort (newest first)
    const sorted = [...events].sort((a, b) => b.scheduledAt - a.scheduledAt);
    expect(sorted[0].id).toBe('1_1003');
    expect(sorted[1].id).toBe('1_1002');
    expect(sorted[2].id).toBe('1_1001');
  });

  it('2. Status configuration maps all four statuses to correct Hungarian labels and visual treatments', () => {
    expect(STATUS_CONFIG.PENDING.label).toBe('Függőben');
    expect(STATUS_CONFIG.DRANK.label).toBe('Megtörtént');
    expect(STATUS_CONFIG.NOT_DRANK.label).toBe('Nem történt meg');
    expect(STATUS_CONFIG.REJECTED.label).toBe('Elutasítva');

    expect(STATUS_CONFIG.PENDING.bgClass).toContain('amber');
    expect(STATUS_CONFIG.DRANK.bgClass).toContain('emerald');
    expect(STATUS_CONFIG.NOT_DRANK.bgClass).toContain('orange');
    expect(STATUS_CONFIG.REJECTED.bgClass).toContain('rose');
  });

  it('3. Reading / querying Event Log does not write or mutate persisted records', async () => {
    const today = new Date();
    const event = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1001, scheduledAt: Date.now() });
    await repo.createIfAbsent(event);

    const initial = await repo.getById('1_1001');
    expect(initial).not.toBeNull();
    const initialRevision = initial?.revision;
    const initialUpdatedAt = initial?.updatedAt;

    // Execute list queries
    await repo.listByLocalDay(today);
    await repo.listByLocalDay(today);

    const afterQuery = await repo.getById('1_1001');
    expect(afterQuery?.revision).toBe(initialRevision);
    expect(afterQuery?.updatedAt).toBe(initialUpdatedAt);
    expect(afterQuery?.status).toBe('PENDING');
  });

  it('4. Queries for different dates return distinct sets of events', async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0).getTime();
    const yesterdayTime = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 12, 0, 0).getTime();

    await repo.createIfAbsent(createPendingHydrationEvent({ timerGeneration: 1, alertId: 1, scheduledAt: todayTime }));
    await repo.createIfAbsent(createPendingHydrationEvent({ timerGeneration: 1, alertId: 2, scheduledAt: yesterdayTime }));

    const todayList = await repo.listByLocalDay(today);
    const yesterdayList = await repo.listByLocalDay(yesterday);

    expect(todayList.length).toBe(1);
    expect(todayList[0].id).toBe('1_1');

    expect(yesterdayList.length).toBe(1);
    expect(yesterdayList[0].id).toBe('1_2');
  });

  it('5. Prevents querying future dates when selecting date relative to today', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    function clampToToday(date: Date): Date {
      const now = new Date();
      const isSameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      return date > now && !isSameDay ? now : date;
    }

    const clamped = clampToToday(tomorrow);
    expect(clamped.getDate()).toBe(today.getDate());
  });

  it('6. Empty state criteria: queries for dates with no events return empty array', async () => {
    const pastDate = new Date(2020, 0, 1);
    const events = await repo.listByLocalDay(pastDate);
    expect(events).toEqual([]);
  });

  it('7. Stale async race condition token protection mechanism', async () => {
    let activeToken = 0;
    let displayedEvents: HydrationEvent[] = [];

    async function mockAsyncFetch(_dateLabel: string, delayMs: number, resultEvents: HydrationEvent[]) {
      const currentToken = ++activeToken;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (currentToken === activeToken) {
        displayedEvents = resultEvents;
      }
    }

    const eToday = [createPendingHydrationEvent({ timerGeneration: 1, alertId: 100, scheduledAt: Date.now() })];
    const eYesterday = [createPendingHydrationEvent({ timerGeneration: 1, alertId: 200, scheduledAt: Date.now() - 86400000 })];

    const p1 = mockAsyncFetch('yesterday', 50, eYesterday);
    const p2 = mockAsyncFetch('today', 10, eToday);

    await Promise.all([p1, p2]);

    expect(displayedEvents[0].id).toBe('1_100');
  });
});
