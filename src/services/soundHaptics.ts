import { SoundEffectType, VibrationPatternType } from '../types';

class SoundHapticsService {
  private audioCtx: AudioContext | null = null;

  private initAudio() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playAlertSound(type: SoundEffectType) {
    if (type === 'silent') return;
    try {
      this.initAudio();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;

      if (type === 'water_drop') {
        // Acoustic water drop sound: quick pitch glide up then resonant decay
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);

        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.7, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.35);

        // Second subtle harmonic drop echo
        setTimeout(() => {
          if (!this.audioCtx) return;
          const t2 = this.audioCtx.currentTime;
          const osc2 = this.audioCtx.createOscillator();
          const gain2 = this.audioCtx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(600, t2);
          osc2.frequency.exponentialRampToValueAtTime(1600, t2 + 0.06);
          gain2.gain.setValueAtTime(0.01, t2);
          gain2.gain.linearRampToValueAtTime(0.4, t2 + 0.03);
          gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.25);
          osc2.connect(gain2);
          gain2.connect(this.audioCtx.destination);
          osc2.start(t2);
          osc2.stop(t2 + 0.25);
        }, 120);
      } else if (type === 'gentle_bell') {
        // Rich crystal bell chime
        const frequencies = [587.33, 880, 1174.66, 1760]; // D5, A5, D6, A6 chords
        frequencies.forEach((freq, idx) => {
          if (!this.audioCtx) return;
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);

          const delay = idx * 0.03;
          gain.gain.setValueAtTime(0.001, now + delay);
          gain.gain.linearRampToValueAtTime(0.3 / (idx + 1), now + delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.6);

          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 1.6);
        });
      } else if (type === 'digital_beep') {
        // Double electronic smartwatch ping
        [0, 0.12, 0.24].forEach((offset, i) => {
          if (!this.audioCtx) return;
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(i === 2 ? 1760 : 1318.5, now + offset);
          gain.gain.setValueAtTime(0.01, now + offset);
          gain.gain.linearRampToValueAtTime(0.4, now + offset + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.08);
        });
      } else if (type === 'radar_pulse') {
        // Radar pulse sweep
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(980, now + 0.4);
        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      }
    } catch {
      // Audio playback fallback
    }
  }

  triggerVibration(pattern: VibrationPatternType) {
    if (typeof window === 'undefined' || !('vibrate' in navigator)) {
      return false;
    }
    try {
      let vibrationSequence: number[] = [200];
      switch (pattern) {
        case 'short':
          vibrationSequence = [150];
          break;
        case 'double':
          vibrationSequence = [200, 100, 200];
          break;
        case 'triple':
          vibrationSequence = [150, 80, 150, 80, 250];
          break;
        case 'long':
          vibrationSequence = [600];
          break;
        case 'heartbeat':
          vibrationSequence = [120, 120, 180, 300, 120, 120, 180];
          break;
      }
      navigator.vibrate(vibrationSequence);
      return true;
    } catch {
      return false;
    }
  }

  private alertIntervalId: number | null = null;

  startAlertLoop(soundType: SoundEffectType, pattern: VibrationPatternType, intervalMs: number = 2500) {
    this.stopAlertLoop();
    this.playAlertSound(soundType);
    this.triggerVibration(pattern);

    this.alertIntervalId = window.setInterval(() => {
      this.playAlertSound(soundType);
      this.triggerVibration(pattern);
    }, intervalMs);
  }

  stopAlertLoop() {
    if (this.alertIntervalId !== null) {
      clearInterval(this.alertIntervalId);
      this.alertIntervalId = null;
    }
  }

  playMissedWarningSound() {
    try {
      this.initAudio();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      // Distinct double warning tone (lower frequency alert)
      [0, 0.22].forEach((offset, idx) => {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(idx === 0 ? 440 : 330, now + offset);

        gain.gain.setValueAtTime(0.01, now + offset);
        gain.gain.linearRampToValueAtTime(0.3, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.18);
      });

      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([100, 80, 200]);
      }
    } catch {
      // Audio fallback
    }
  }

  async sendSystemNotification(title: string, body: string, tag: string = 'hydro-timer-reminder'): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }

    try {
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag,
        });
        return true;
      } else if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          new Notification(title, {
            body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag,
          });
          return true;
        }
      }
    } catch {
      // Notification API fallback
    }
    return false;
  }
}

export const soundHaptics = new SoundHapticsService();
