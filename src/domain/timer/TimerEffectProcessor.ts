import { TimerEffect } from './types';
import { TimerRepository } from './TimerRepository';
import { BrowserScheduler } from './BrowserScheduler';
import { HydrationEventRepository } from '../eventlog/HydrationEventRepository';
import { createPendingHydrationEvent } from '../eventlog/types';

export interface TimerEffectProcessorOptions {
  scheduler?: BrowserScheduler | null;
  eventRepository?: HydrationEventRepository | null;
  onShowReminder?: (timerGeneration: number, alertId: number, intakeMl?: number, dailyGoalMl?: number) => void;
  onRecordDrink?: (amountMl: number) => void;
  onRecordAck?: () => void;
  onRecordMissed?: (durationSec: number) => void;
  onShowMissedNotice?: (notice: { title: string; timeStr: string; alertDuration: number }) => void;
  title?: string;
}

/**
 * Executes state machine transition side-effects on Web.
 * Handles timer/alert scheduling, state persistence, notifications, callbacks, and hydration event log creation.
 */
export async function processTimerEffects(
  effects: TimerEffect[],
  options: TimerEffectProcessorOptions = {}
): Promise<void> {
  if (options.scheduler) {
    options.scheduler.handleEffects(effects);
  }

  for (const effect of effects) {
    switch (effect.type) {
      case 'PersistState':
        TimerRepository.saveSnapshot(effect.snapshot);
        break;
      case 'ShowReminder':
        if (options.onShowReminder) {
          options.onShowReminder(effect.timerGeneration, effect.alertId, effect.intakeMl, effect.dailyGoalMl);
        }
        break;
      case 'RecordDrink':
        if (options.onRecordDrink) {
          options.onRecordDrink(effect.amountMl);
        }
        break;
      case 'RecordAck':
        if (options.onRecordAck) {
          options.onRecordAck();
        }
        break;
      case 'RecordMissed':
        break;
      case 'ShowMissedNotification': {
        const nowStr = new Date().toLocaleTimeString('hu-HU', {
          hour: '2-digit',
          minute: '2-digit',
        });
        if (options.onShowMissedNotice) {
          options.onShowMissedNotice({
            title: options.title ?? 'Vízivás',
            timeStr: nowStr,
            alertDuration: effect.alertDurationSeconds,
          });
        }
        if (options.onRecordMissed) {
          options.onRecordMissed(effect.alertDurationSeconds);
        }
        break;
      }
      case 'CreateHydrationEvent': {
        if (options.eventRepository) {
          const pendingEvent = createPendingHydrationEvent({
            timerGeneration: effect.timerGeneration,
            alertId: effect.alertId,
            scheduledAt: effect.scheduledAt,
            intakeMl: effect.intakeMl,
            dailyGoalMl: effect.dailyGoalMl,
          });
          try {
            await options.eventRepository.createIfAbsent(pendingEvent);
          } catch (err) {
            console.error('Failed to create hydration event:', err);
          }
        }
        break;
      }
    }
  }
}
