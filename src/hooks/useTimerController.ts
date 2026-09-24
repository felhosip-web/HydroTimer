import { useState, useEffect, useRef, useCallback } from 'react';
import {
  TimerSnapshot,
  EngineConfig,
  TimerEvent,
  TimerEffect,
} from '../domain/timer/types';
import { TimerDomainEngine } from '../domain/timer/TimerDomainEngine';
import { TimerRepository } from '../domain/timer/TimerRepository';
import { BrowserScheduler } from '../domain/timer/BrowserScheduler';
import { TimerConfig } from '../types';

interface UseTimerControllerProps {
  config: TimerConfig;
  onRecordDrink?: (amountMl: number) => void;
  onRecordAck?: () => void;
  onRecordMissed?: (durationSec: number) => void;
  onShowReminder?: (timerGeneration: number, alertId: number) => void;
}

export function useTimerController({
  config,
  onRecordDrink,
  onRecordAck,
  onRecordMissed,
  onShowReminder,
}: UseTimerControllerProps) {
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(() => {
    return TimerRepository.loadSnapshot();
  });

  const [missedAlertNotice, setMissedAlertNotice] = useState<{
    title: string;
    timeStr: string;
    alertDuration: number;
  } | null>(null);

  const snapshotRef = useRef<TimerSnapshot>(snapshot);
  snapshotRef.current = snapshot;

  const configRef = useRef<TimerConfig>(config);
  configRef.current = config;

  const schedulerRef = useRef<BrowserScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = new BrowserScheduler();
  }

  const getEngineConfig = useCallback((cfg: TimerConfig = configRef.current): EngineConfig => {
    return {
      mode: cfg.mode,
      intervalMinutes: cfg.intervalMinutes,
      countdownMinutes: cfg.countdownMinutes,
      countdownSeconds: cfg.countdownSeconds || 0,
      alertDurationSeconds: Math.max(5, cfg.alertDurationSeconds || 15),
      intervalMode: cfg.intervalMode || 'free',
      clockIntervalMinutes: cfg.clockIntervalMinutes || 30,
      autoRestart: cfg.autoRestart !== false,
      intakePerAlertMl: cfg.intakeMlPerAlert,
      quietHoursEnabled: cfg.quietHoursEnabled,
      quietHoursStart: cfg.quietHoursStart,
      quietHoursEnd: cfg.quietHoursEnd,
      activeDays: cfg.activeDays || [true, true, true, true, true, true, true],
    };
  }, []);

  // Execute effects produced by state machine transitions
  const executeEffects = useCallback(
    (effects: TimerEffect[]) => {
      if (schedulerRef.current) {
        schedulerRef.current.handleEffects(effects);
      }

      for (const effect of effects) {
        switch (effect.type) {
          case 'PersistState':
            TimerRepository.saveSnapshot(effect.snapshot);
            break;
          case 'ShowReminder':
            if (onShowReminder) {
              onShowReminder(effect.timerGeneration, effect.alertId);
            }
            break;
          case 'RecordDrink':
            if (onRecordDrink) {
              onRecordDrink(effect.amountMl);
            }
            break;
          case 'RecordAck':
            if (onRecordAck) {
              onRecordAck();
            }
            break;
          case 'RecordMissed':
            break;
          case 'ShowMissedNotification': {
            const nowStr = new Date().toLocaleTimeString('hu-HU', {
              hour: '2-digit',
              minute: '2-digit',
            });
            setMissedAlertNotice({
              title: configRef.current.title,
              timeStr: nowStr,
              alertDuration: effect.alertDurationSeconds,
            });
            if (onRecordMissed) {
              onRecordMissed(effect.alertDurationSeconds);
            }
            break;
          }
        }
      }
    },
    [onShowReminder, onRecordDrink, onRecordAck, onRecordMissed]
  );

  // Core event dispatch method
  const dispatch = useCallback(
    (event: TimerEvent, overrideConfig?: TimerConfig): TimerSnapshot => {
      if (overrideConfig) {
        configRef.current = overrideConfig;
      }
      const currentSnap = snapshotRef.current;
      const engineCfg = getEngineConfig(overrideConfig);
      const result = TimerDomainEngine.processEvent(currentSnap, event, engineCfg, event.timestamp);

      snapshotRef.current = result.newSnapshot;
      setSnapshot(result.newSnapshot);
      executeEffects(result.effects);

      return result.newSnapshot;
    },
    [getEngineConfig, executeEffects]
  );

  // Set up scheduler dispatcher
  useEffect(() => {
    if (schedulerRef.current) {
      schedulerRef.current.setDispatcher((scheduledEvent) => {
        dispatch({
          type: scheduledEvent.type,
          timerGeneration: scheduledEvent.timerGeneration,
          alertId: scheduledEvent.alertId,
          timestamp: scheduledEvent.timestamp,
        });
      });
    }
  }, [dispatch]);

  // Initial boot / recovery
  useEffect(() => {
    dispatch({
      type: 'RECOVER',
      timestamp: Date.now(),
    });
  }, [dispatch]);

  // Handle page visibility change / tab focus recovery
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        dispatch({
          type: 'RECOVER',
          timestamp: Date.now(),
        });
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [dispatch]);

  // Helper action methods
  const startTimer = useCallback(
    (overrideConfig?: TimerConfig) => {
      dispatch(
        {
          type: 'START',
          timestamp: Date.now(),
        },
        overrideConfig
      );
    },
    [dispatch]
  );

  const stopTimer = useCallback(() => {
    dispatch({
      type: 'STOP',
      timerGeneration: snapshotRef.current.timerGeneration,
      timestamp: Date.now(),
    });
  }, [dispatch]);

  const acknowledge = useCallback(
    (withWater: boolean = false) => {
      const current = snapshotRef.current;
      if (current.state !== 'ALERT_ACTIVE' || current.alertId === null) return;

      const eventType = withWater ? 'DRINK' : 'ACKNOWLEDGE';
      dispatch({
        type: eventType,
        timerGeneration: current.timerGeneration,
        alertId: current.alertId,
        timestamp: Date.now(),
      });
    },
    [dispatch]
  );

  const triggerTestAlert = useCallback(() => {
    let current = snapshotRef.current;
    if (current.state === 'STOPPED') {
      current = dispatch({
        type: 'START',
        timestamp: Date.now(),
      });
    }

    dispatch({
      type: 'TIMER_TRIGGER',
      timerGeneration: current.timerGeneration,
      timestamp: Date.now(),
    });
  }, [dispatch]);

  // Calculate remaining seconds derived from canonical absolute timestamps
  const totalDuration =
    config.mode === 'countdown'
      ? config.countdownMinutes * 60 + (config.countdownSeconds || 0)
      : config.intervalMinutes * 60;

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    if (snapshot.state === 'WAITING' && snapshot.nextTriggerAt) {
      return Math.max(0, Math.ceil((snapshot.nextTriggerAt - Date.now()) / 1000));
    }
    return totalDuration;
  });

  const [alertSecondsLeft, setAlertSecondsLeft] = useState<number>(() => {
    if (snapshot.state === 'ALERT_ACTIVE' && snapshot.alertDeadlineAt) {
      return Math.max(0, Math.ceil((snapshot.alertDeadlineAt - Date.now()) / 1000));
    }
    return Math.max(5, config.alertDurationSeconds || 15);
  });

  // UI Tick interval to refresh countdowns from absolute timestamps
  useEffect(() => {
    const updateTimeDisplays = () => {
      const current = snapshotRef.current;
      const now = Date.now();

      if (current.state === 'WAITING' && current.nextTriggerAt) {
        const rem = Math.max(0, Math.ceil((current.nextTriggerAt - now) / 1000));
        setRemainingSeconds(rem);
      } else if (current.state === 'STOPPED') {
        const total =
          configRef.current.mode === 'countdown'
            ? configRef.current.countdownMinutes * 60 + (configRef.current.countdownSeconds || 0)
            : configRef.current.intervalMinutes * 60;
        setRemainingSeconds(total);
      }

      if (current.state === 'ALERT_ACTIVE' && current.alertDeadlineAt) {
        const alertRem = Math.max(0, Math.ceil((current.alertDeadlineAt - now) / 1000));
        setAlertSecondsLeft(alertRem);
      }
    };

    updateTimeDisplays();
    const interval = setInterval(updateTimeDisplays, 500);
    return () => clearInterval(interval);
  }, [snapshot, config]);

  return {
    snapshot,
    isRunning: snapshot.state !== 'STOPPED',
    isAlerting: snapshot.state === 'ALERT_ACTIVE',
    remainingSeconds,
    alertSecondsLeft,
    totalDuration,
    missedAlertNotice,
    dispatch,
    startTimer,
    stopTimer,
    acknowledge,
    triggerTestAlert,
    dismissMissedNotice: () => setMissedAlertNotice(null),
  };
}
