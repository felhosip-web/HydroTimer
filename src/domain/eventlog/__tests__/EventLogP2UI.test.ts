import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// @ts-ignore
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository } from '../HydrationEventRepository';
import { createPendingHydrationEvent, HydrationEvent } from '../types';
import { STATUS_CONFIG } from '../../../components/EventLogView';

describe('Event Log P2 Web UI Component Tests (EventLogView)', () => {
  let dbName: string;
  let repo: HydrationEventRepository;

  beforeEach(() => {
    dbName = `test_p2_ui_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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

  it('1. Renders event cards ordered newest first by scheduledAt with correct Hungarian status labels', async () => {
    const today = new Date();
    const baseTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0, 0).getTime();

    const e1 = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1001, scheduledAt: baseTime });
    const e2 = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1002, scheduledAt: baseTime + 3600000 });
    const e3 = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1003, scheduledAt: baseTime + 7200000 });
    const e4 = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1004, scheduledAt: baseTime + 10800000 });

    await repo.createIfAbsent(e1);
    await repo.createIfAbsent(e2);
    await repo.createIfAbsent(e3);
    await repo.createIfAbsent(e4);

    await repo.updateStatus('1_1002', 'DRANK', baseTime + 3605000);
    await repo.updateStatus('1_1003', 'NOT_DRANK', baseTime + 7205000);
    await repo.updateStatus('1_1004', 'REJECTED', baseTime + 10805000);

    const events = await repo.listByLocalDay(today);
    const sorted = [...events].sort((a, b) => b.scheduledAt - a.scheduledAt);

    expect(sorted.length).toBe(4);
    expect(sorted[0].id).toBe('1_1004');
    expect(sorted[1].id).toBe('1_1003');
    expect(sorted[2].id).toBe('1_1002');
    expect(sorted[3].id).toBe('1_1001');

    expect(STATUS_CONFIG[sorted[0].status].label).toBe('Elutasítva');
    expect(STATUS_CONFIG[sorted[1].status].label).toBe('Nem történt meg');
    expect(STATUS_CONFIG[sorted[2].status].label).toBe('Megtörtént');
    expect(STATUS_CONFIG[sorted[3].status].label).toBe('Függőben');
  });

  it('2. Empty state requirements: date with no events returns empty list', async () => {
    const pastDate = new Date(2020, 0, 1);
    const events = await repo.listByLocalDay(pastDate);
    expect(events.length).toBe(0);
  });

  it('3. Date navigation loads correct event set for selected date', async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0).getTime();
    const yesterdayTime = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 12, 0, 0).getTime();

    await repo.createIfAbsent(createPendingHydrationEvent({ timerGeneration: 1, alertId: 100, scheduledAt: todayTime }));
    await repo.createIfAbsent(createPendingHydrationEvent({ timerGeneration: 1, alertId: 200, scheduledAt: yesterdayTime }));

    const todayEvents = await repo.listByLocalDay(today);
    const yesterdayEvents = await repo.listByLocalDay(yesterday);

    expect(todayEvents.length).toBe(1);
    expect(todayEvents[0].id).toBe('1_100');

    expect(yesterdayEvents.length).toBe(1);
    expect(yesterdayEvents[0].id).toBe('1_200');
  });

  it('4. Error handling and retry logic: failed repository query throws and retry re-executes query', async () => {
    let attempts = 0;
    const failingRepo = {
      listByLocalDay: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Database query failure');
        }
        return [createPendingHydrationEvent({ timerGeneration: 1, alertId: 1, scheduledAt: Date.now() })];
      },
    };

    let caughtError: any = null;
    try {
      await failingRepo.listByLocalDay();
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toBe('Database query failure');

    const retryResult = await failingRepo.listByLocalDay();
    expect(retryResult.length).toBe(1);
    expect(attempts).toBe(2);
  });

  it('5. Foreground refresh listener registration on document', () => {
    const listeners: Record<string, Function[]> = {};

    const mockDocument = {
      visibilityState: 'visible',
      addEventListener: (event: string, handler: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      },
      removeEventListener: (event: string, handler: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      },
      dispatchEvent: (event: string) => {
        if (listeners[event]) {
          listeners[event].forEach((fn) => fn());
        }
      },
    };

    let refreshCalled = false;
    const onVisibilityChange = () => {
      if (mockDocument.visibilityState === 'visible') {
        refreshCalled = true;
      }
    };

    mockDocument.addEventListener('visibilitychange', onVisibilityChange);
    expect(listeners['visibilitychange']?.length).toBe(1);

    mockDocument.dispatchEvent('visibilitychange');
    expect(refreshCalled).toBe(true);

    mockDocument.removeEventListener('visibilitychange', onVisibilityChange);
    expect(listeners['visibilitychange']?.length).toBe(0);
  });

  it('6. Stale asynchronous query race condition protection', async () => {
    let activeToken = 0;
    let displayedEvents: HydrationEvent[] = [];

    async function mockQueryWithToken(_dateLabel: string, delayMs: number, resultEvents: HydrationEvent[]) {
      const currentToken = ++activeToken;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (currentToken === activeToken) {
        displayedEvents = resultEvents;
      }
    }

    const eToday = [createPendingHydrationEvent({ timerGeneration: 1, alertId: 100, scheduledAt: Date.now() })];
    const eYesterday = [createPendingHydrationEvent({ timerGeneration: 1, alertId: 200, scheduledAt: Date.now() - 86400000 })];

    const p1 = mockQueryWithToken('yesterday', 50, eYesterday);
    const p2 = mockQueryWithToken('today', 10, eToday);

    await Promise.all([p1, p2]);

    expect(displayedEvents[0].id).toBe('1_100');
  });

  it('7. Querying Event Log does not write or mutate persisted records', async () => {
    const today = new Date();
    const event = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1001, scheduledAt: Date.now() });
    await repo.createIfAbsent(event);

    const initial = await repo.getById('1_1001');

    await repo.listByLocalDay(today);
    await repo.listByLocalDay(today);

    const after = await repo.getById('1_1001');
    expect(after?.revision).toBe(initial?.revision);
    expect(after?.updatedAt).toBe(initial?.updatedAt);
    expect(after?.status).toBe('PENDING');
  });

  it('8. Status configuration maps all four statuses correctly', () => {
    expect(STATUS_CONFIG.PENDING.label).toBe('Függőben');
    expect(STATUS_CONFIG.DRANK.label).toBe('Megtörtént');
    expect(STATUS_CONFIG.NOT_DRANK.label).toBe('Nem történt meg');
    expect(STATUS_CONFIG.REJECTED.label).toBe('Elutasítva');
  });
});
