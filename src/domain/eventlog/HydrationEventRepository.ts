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
 * Uses local calendar date components to ensure daylight-saving transitions are correctly handled.
 */
export function getLocalDayBounds(date: Date): { startOfDay: number; startOfNextDay: number } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  const startOfDay = new Date(year, month, day, 0, 0, 0, 0).getTime();
  const startOfNextDay = new Date(year, month, day + 1, 0, 0, 0, 0).getTime();

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
  public async listByLocalDay(date: Date): Promise<HydrationEvent[]> {
    const { startOfDay, startOfNextDay } = getLocalDayBounds(date);
    return this.db.events
      .where('scheduledAt')
      .between(startOfDay, startOfNextDay, true, false)
      .toArray();
  }

  /**
   * Updates the status of an existing event.
   * Throws an Error if the event is not found or database update fails.
   */
  public async updateStatus(
    id: string,
    status: HydrationEventStatus,
    updatedAt: number = Date.now()
  ): Promise<HydrationEvent> {
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
