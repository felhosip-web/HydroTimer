export type HydrationEventStatus = 'PENDING' | 'DRANK' | 'NOT_DRANK' | 'REJECTED';

export interface HydrationEvent {
  /** Stable unique event identifier, e.g., "${timerGeneration}_${alertId}" */
  id: string;
  /** Timer generation associated with the reminder */
  timerGeneration: number;
  /** Alert identifier */
  alertId: number;
  /** Original scheduled timestamp in Unix milliseconds */
  scheduledAt: number;
  /** Record creation timestamp in Unix milliseconds */
  createdAt: number;
  /** Explicit event status */
  status: HydrationEventStatus;
  /** Last status-change timestamp in Unix milliseconds */
  updatedAt: number;
  /** Optional version field for optimistic locking / schema evolution */
  revision?: number;
}

/**
 * Generates a deterministic, stable unique identifier for a hydration reminder event
 * based on timer generation and alert ID.
 */
export function generateHydrationEventId(timerGeneration: number, alertId: number): string {
  return `${timerGeneration}_${alertId}`;
}

export interface CreatePendingEventParams {
  timerGeneration: number;
  alertId: number;
  scheduledAt: number;
  createdAt?: number;
}

/**
 * Helper factory function to construct a new HydrationEvent starting in 'PENDING' status.
 */
export function createPendingHydrationEvent(params: CreatePendingEventParams): HydrationEvent {
  const createdAt = params.createdAt ?? Date.now();
  return {
    id: generateHydrationEventId(params.timerGeneration, params.alertId),
    timerGeneration: params.timerGeneration,
    alertId: params.alertId,
    scheduledAt: params.scheduledAt,
    createdAt,
    status: 'PENDING',
    updatedAt: createdAt,
    revision: 1,
  };
}
