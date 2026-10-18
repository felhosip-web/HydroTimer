import Dexie, { Table } from 'dexie';
import { HydrationEvent, HydrationEventStatus } from './types';

export class HydrationDatabase extends Dexie {
  events!: Table<HydrationEvent, string>;

  constructor(dbName: string = 'HydroTimerEventsDB') {
    super(dbName);
    this.version(1).stores({
      events: 'id, scheduledAt, status, createdAt',
    });
  }
}

/**
 * Calculates local start-of-day and start-of-next-day Unix millisecond boundaries for a given Date.
 * If `timeZone` is specified (e.g. 'Europe/Budapest'), computes boundaries deterministically
 * for that target timezone regardless of host machine timezone settings.
 */
export function getLocalDayBounds(
  date: Date,
  timeZone?: string
): { startOfDay: number; startOfNextDay: number } {
  if (!timeZone) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    const startOfDay = new Date(year, month, day, 0, 0, 0, 0).getTime();
    const startOfNextDay = new Date(year, month, day + 1, 0, 0, 0, 0).getTime();

    return { startOfDay, startOfNextDay };
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10) - 1;
  const day = parseInt(partMap.day, 10);

  function getStartOfDayEpoch(y: number, m: number, d: number): number {
    let utc = Date.UTC(y, m, d, 0, 0, 0, 0);
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    for (let i = 0; i < 5; i++) {
      const p = tzFormatter.formatToParts(new Date(utc));
      const mP: Record<string, string> = {};
      for (const part of p) mP[part.type] = part.value;
      const h = parseInt(mP.hour, 10) % 24;
      const min = parseInt(mP.minute, 10);
      const s = parseInt(mP.second, 10);
      const dy = parseInt(mP.day, 10);

      let dayDiff = dy - d;
      if (dayDiff > 15) dayDiff = -1;
      if (dayDiff < -15) dayDiff = 1;

      const diffMs = ((dayDiff * 24 + h) * 60 + min) * 60000 + s * 1000;
      if (diffMs === 0) break;
      utc -= diffMs;
    }
    return utc;
  }

  const startOfDay = getStartOfDayEpoch(year, month, day);
  const nextDate = new Date(Date.UTC(year, month, day + 1));
  const startOfNextDay = getStartOfDayEpoch(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth(),
    nextDate.getUTCDate()
  );

  return { startOfDay, startOfNextDay };
}

export class HydrationEventRepository {
  private db: HydrationDatabase;

  constructor(dbNameOrInstance?: string | HydrationDatabase) {
    if (dbNameOrInstance instanceof HydrationDatabase) {
      this.db = dbNameOrInstance;
    } else {
      this.db = new HydrationDatabase(dbNameOrInstance);
    }
  }

  /**
   * Creates an event if absent. Uses the stable primary key `id`.
   * If an event with the same ID already exists, returns the existing record without overwriting.
   */
  public async createIfAbsent(event: HydrationEvent): Promise<HydrationEvent> {
    try {
      await this.db.events.add(event);
      return event;
    } catch (err: unknown) {
      const isConstraintError =
        (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'ConstraintError') ||
        (err instanceof Error && (err.message.includes('Constraint') || err.message.includes('Key already exists')));

      if (isConstraintError) {
        const existing = await this.db.events.get(event.id);
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Retrieves an event by its unique ID.
   */
  public async getById(id: string): Promise<HydrationEvent | null> {
    const record = await this.db.events.get(id);
    return record ?? null;
  }

  /**
   * Lists events scheduled on the local calendar day corresponding to `date`.
   */
  public async listByLocalDay(date: Date, timeZone?: string): Promise<HydrationEvent[]> {
    const { startOfDay, startOfNextDay } = getLocalDayBounds(date, timeZone);
    return this.db.events
      .where('scheduledAt')
      .between(startOfDay, startOfNextDay, true, false)
      .toArray();
  }

  /**
   * Updates the status of an existing event atomically using a Dexie read-write transaction.
   * Throws an Error if the event is not found or database update fails.
   */
  public async updateStatus(
    id: string,
    status: HydrationEventStatus,
    updatedAt: number = Date.now()
  ): Promise<HydrationEvent> {
    return this.db.transaction('rw', this.db.events, async () => {
      const existing = await this.db.events.get(id);
      if (!existing) {
        throw new Error(`HydrationEvent with id '${id}' not found.`);
      }

      const updatedEvent: HydrationEvent = {
        ...existing,
        status,
        updatedAt,
        revision: (existing.revision ?? 1) + 1,
      };

      await this.db.events.put(updatedEvent);
      return updatedEvent;
    });
  }

  /**
   * Lists all pending hydration events.
   */
  public async listPending(): Promise<HydrationEvent[]> {
    return this.db.events.where('status').equals('PENDING').toArray();
  }

  /**
   * Helper method for test cleanup or reset.
   */
  public async clear(): Promise<void> {
    await this.db.events.clear();
  }

  /**
   * Closes the database connection.
   */
  public close(): void {
    this.db.close();
  }
}
