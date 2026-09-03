export type PresetId = 'water' | 'stretch' | 'eye_rest' | 'medicine' | 'walk' | 'focus' | 'custom';

export type TimerMode = 'interval' | 'countdown';

export type SoundEffectType = 'water_drop' | 'gentle_bell' | 'digital_beep' | 'radar_pulse' | 'silent';

export type VibrationPatternType = 'short' | 'double' | 'triple' | 'long' | 'heartbeat';

export interface CustomEventItem {
  id: string;
  title: string;
  icon: 'water' | 'stretch' | 'eye' | 'medicine' | 'walk' | 'focus' | 'bell' | 'heart';
  intervalMinutes: number; // For interval mode (e.g. 30)
  alertDurationSeconds: number; // Minimum 5s (5, 15, 30 or custom)
  soundType: SoundEffectType;
  vibrationPattern: VibrationPatternType;
  intakeMl?: number;
  color?: string;
  category?: string;
}

export interface TimerConfig {
  mode: TimerMode;
  presetId: PresetId;
  title: string;
  intervalMinutes: number;
  countdownMinutes: number;
  countdownSeconds: number;
  alertDurationSeconds: number; // Min 5s, presets: 5, 15, 30 or custom
  soundType: SoundEffectType;
  vibrationPattern: VibrationPatternType;
  autoRestart: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string;   // "07:00"
  intakeMlPerAlert: number;
  dailyGoalMl: number;
  customEvents: CustomEventItem[]; // Maximum 6 events
}

export interface ActivityLog {
  id: string;
  timestamp: number;
  presetId: PresetId | string;
  title: string;
  mode?: TimerMode;
  amountMl?: number;
  completedOnWatch: boolean;
  missed?: boolean;
}

export interface BluetoothDeviceState {
  isConnected: boolean;
  deviceName: string | null;
  batteryLevel: number | null;
  heartRate: number | null;
  isScanning: boolean;
  error: string | null;
}
