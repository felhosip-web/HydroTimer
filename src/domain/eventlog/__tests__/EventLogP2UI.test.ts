import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const domWindow = new Window();
globalThis.window = domWindow as any;
globalThis.document = domWindow.document as any;
globalThis.navigator = domWindow.navigator as any;
globalThis.HTMLElement = domWindow.HTMLElement as any;
globalThis.Event = domWindow.Event as any;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// @ts-ignore
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HydrationEventRepository } from '../HydrationEventRepository';
import { createPendingHydrationEvent, HydrationEvent } from '../types';
import { EventLogView } from '../../../components/EventLogView';

const flushPromises = async () => {
  await new Promise<void>((r) => queueMicrotask(() => r()));
  await new Promise<void>((r) => queueMicrotask(() => r()));
};

describe('Event Log P2 Web UI Component Tests (EventLogView)', () => {
  let dbName: string;
  let repo: HydrationEventRepository;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dbName = `test_p2_ui_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    repo = new HydrationEventRepository(dbName);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    try {
      await repo.clear();
      repo.close();
    } catch {
      // Ignore
    }
  });

  it('1. Renders event cards ordered newest first directly in DOM with correct Hungarian status labels', async () => {
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

    await act(async () => {
      root.render(React.createElement(EventLogView, { repository: repo }));
    });

    await act(async () => {
      await flushPromises();
    });

    const cardElements = container.querySelectorAll('.space-y-2 > div');
    expect(cardElements.length).toBe(4);

    expect(cardElements[0].textContent).toContain('Elutasítva');
    expect(cardElements[1].textContent).toContain('Nem történt meg');
    expect(cardElements[2].textContent).toContain('Megtörtént');
    expect(cardElements[3].textContent).toContain('Függőben');
  });

  it('2. Exercising prev/next day buttons in DOM asserts dates passed to listByLocalDay and blocks future dates', async () => {
    const datesQueried: Date[] = [];
    const stubRepo = {
      listByLocalDay: async (d: Date) => {
        datesQueried.push(new Date(d));
        return [];
      },
    } as any;

    await act(async () => {
      root.render(React.createElement(EventLogView, { repository: stubRepo }));
    });

    await act(async () => {
      await flushPromises();
    });

    expect(datesQueried.length).toBe(1);

    const prevBtn = container.querySelector('#btn-prev-day') as HTMLButtonElement;
    expect(prevBtn).not.toBeNull();

    await act(async () => {
      prevBtn.click();
    });

    await act(async () => {
      await flushPromises();
    });

    expect(datesQueried.length).toBe(2);
    const dayDiffMs = datesQueried[0].getTime() - datesQueried[1].getTime();
    expect(Math.round(dayDiffMs / (1000 * 3600 * 24))).toBe(1);

    const nextBtn = container.querySelector('#btn-next-day') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);

    await act(async () => {
      nextBtn.click();
    });

    await act(async () => {
      await flushPromises();
    });

    expect(datesQueried.length).toBe(3);
    expect(nextBtn.disabled).toBe(true);
  });

  it('3. Renders empty and error states in DOM and retry button re-invokes listByLocalDay', async () => {
    let callCount = 0;
    const failingRepo = {
      listByLocalDay: async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Database query failure');
        }
        return [];
      },
    } as any;

    await act(async () => {
      root.render(React.createElement(EventLogView, { repository: failingRepo }));
    });

    await act(async () => {
      await flushPromises();
    });

    expect(container.textContent).toContain('Nem sikerült az események betöltése.');

    const retryBtn = container.querySelector('#btn-retry-events') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();

    await act(async () => {
      retryBtn.click();
    });

    await act(async () => {
      await flushPromises();
    });

    expect(callCount).toBe(2);
    expect(container.textContent).toContain('Erre a napra nincs rögzített esemény.');
  });

  it('4. Document visibilitychange event triggers fresh repository query in EventLogView', async () => {
    let queryCount = 0;
    const trackingRepo = {
      listByLocalDay: async () => {
        queryCount++;
        return [];
      },
    } as any;

    await act(async () => {
      root.render(React.createElement(EventLogView, { repository: trackingRepo }));
    });

    await act(async () => {
      await flushPromises();
    });

    const initial = queryCount;
    expect(initial).toBeGreaterThanOrEqual(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await flushPromises();
    });

    expect(queryCount).toBeGreaterThan(initial);
  });

  it('5. Overlapping async queries resolved in reverse order do not overwrite currently selected date in DOM', async () => {
    let callIndex = 0;
    const pendingResolves: Array<(val: HydrationEvent[]) => void> = [];

    const raceRepo = {
      listByLocalDay: async () => {
        callIndex++;
        const idx = callIndex;
        return new Promise<HydrationEvent[]>((resolve) => {
          pendingResolves[idx] = resolve;
        });
      },
    } as any;

    await act(async () => {
      root.render(React.createElement(EventLogView, { repository: raceRepo }));
    });

    const prevBtn = container.querySelector('#btn-prev-day') as HTMLButtonElement;
    await act(async () => {
      prevBtn.click();
    });

    const yesterdayTime = new Date();
    yesterdayTime.setDate(yesterdayTime.getDate() - 1);
    yesterdayTime.setHours(16, 0, 0, 0);

    const todayTime = new Date();
    todayTime.setHours(8, 0, 0, 0);

    await act(async () => {
      pendingResolves[2]([createPendingHydrationEvent({ timerGeneration: 1, alertId: 222, scheduledAt: yesterdayTime.getTime() })]);
    });

    await act(async () => {
      await flushPromises();
    });

    expect(container.textContent).toContain('16:00');

    await act(async () => {
      pendingResolves[1]([createPendingHydrationEvent({ timerGeneration: 1, alertId: 111, scheduledAt: todayTime.getTime() })]);
    });

    await act(async () => {
      await flushPromises();
    });

    expect(container.textContent).toContain('16:00');
    expect(container.textContent).not.toContain('08:00');
  });

  it('6. Rendering EventLogView does not write or mutate persisted records in IndexedDB', async () => {
    const today = new Date();
    const event = createPendingHydrationEvent({ timerGeneration: 1, alertId: 1001, scheduledAt: Date.now() });
    await repo.createIfAbsent(event);

    const initial = await repo.getById('1_1001');

    await act(async () => {
      root.render(React.createElement(EventLogView, { repository: repo }));
    });

    await act(async () => {
      await flushPromises();
    });

    const after = await repo.getById('1_1001');
    expect(after?.revision).toBe(initial?.revision);
    expect(after?.updatedAt).toBe(initial?.updatedAt);
    expect(after?.status).toBe('PENDING');
  });
});
