import { TimerSnapshot } from './types';

const SNAPSHOT_KEY = 'hydro_timer_snapshot';

export const DEFAULT_SNAPSHOT: TimerSnapshot = {
  state: 'STOPPED',
  timerGeneration: 0,
  alertId: null,
  lastAlertId: 0,
  nextTriggerAt: null,
  alertStartedAt: null,
  alertDeadlineAt: null,
};

export class TimerRepository {
  public static loadSnapshot(): TimerSnapshot {
    try {
      const data = localStorage.getItem(SNAPSHOT_KEY);
      if (!data) return { ...DEFAULT_SNAPSHOT };
      const parsed = JSON.parse(data);
      return {
        state: parsed.state || 'STOPPED',
        timerGeneration: typeof parsed.timerGeneration === 'number' ? parsed.timerGeneration : 0,
        alertId: typeof parsed.alertId === 'number' ? parsed.alertId : null,
        lastAlertId: typeof parsed.lastAlertId === 'number' ? parsed.lastAlertId : 0,
        nextTriggerAt: typeof parsed.nextTriggerAt === 'number' ? parsed.nextTriggerAt : null,
        alertStartedAt: typeof parsed.alertStartedAt === 'number' ? parsed.alertStartedAt : null,
        alertDeadlineAt: typeof parsed.alertDeadlineAt === 'number' ? parsed.alertDeadlineAt : null,
      };
    } catch {
      return { ...DEFAULT_SNAPSHOT };
    }
  }

  public static saveSnapshot(snapshot: TimerSnapshot): void {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.error('Failed to save TimerSnapshot to localStorage', e);
    }
  }

  public static clearSnapshot(): void {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
    } catch (e) {
      console.error('Failed to clear TimerSnapshot from localStorage', e);
    }
  }
}
