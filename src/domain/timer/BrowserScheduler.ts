import { TimerEffect } from './types';

export type EventDispatcher = (event: {
  type: 'TIMER_TRIGGER' | 'ALERT_TIMEOUT';
  timerGeneration: number;
  alertId?: number | null;
  timestamp: number;
}) => void;

export class BrowserScheduler {
  private timerTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private alertTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private dispatcher: EventDispatcher | null = null;

  public setDispatcher(dispatcher: EventDispatcher): void {
    this.dispatcher = dispatcher;
  }

  public handleEffects(effects: TimerEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'ScheduleTimer':
          this.scheduleTimerTrigger(effect.triggerAtMillis, effect.timerGeneration);
          break;
        case 'CancelTimer':
          this.cancelTimerTrigger();
          break;
        case 'ScheduleAlertTimeout':
          this.scheduleAlertTimeout(effect.deadlineAtMillis, effect.timerGeneration, effect.alertId);
          break;
        case 'CancelAlertTimeout':
          this.cancelAlertTimeout();
          break;
      }
    }
  }

  private scheduleTimerTrigger(triggerAtMillis: number, timerGeneration: number): void {
    this.cancelTimerTrigger();
    const delay = Math.max(0, triggerAtMillis - Date.now());
    this.timerTimeoutId = setTimeout(() => {
      this.timerTimeoutId = null;
      if (this.dispatcher) {
        this.dispatcher({
          type: 'TIMER_TRIGGER',
          timerGeneration,
          timestamp: Date.now(),
        });
      }
    }, delay);
  }

  private cancelTimerTrigger(): void {
    if (this.timerTimeoutId !== null) {
      clearTimeout(this.timerTimeoutId);
      this.timerTimeoutId = null;
    }
  }

  private scheduleAlertTimeout(deadlineAtMillis: number, timerGeneration: number, alertId: number): void {
    this.cancelAlertTimeout();
    const delay = Math.max(0, deadlineAtMillis - Date.now());
    this.alertTimeoutId = setTimeout(() => {
      this.alertTimeoutId = null;
      if (this.dispatcher) {
        this.dispatcher({
          type: 'ALERT_TIMEOUT',
          timerGeneration,
          alertId,
          timestamp: Date.now(),
        });
      }
    }, delay);
  }

  private cancelAlertTimeout(): void {
    if (this.alertTimeoutId !== null) {
      clearTimeout(this.alertTimeoutId);
      this.alertTimeoutId = null;
    }
  }

  public clearAll(): void {
    this.cancelTimerTrigger();
    this.cancelAlertTimeout();
  }
}
