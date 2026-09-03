import { BluetoothDeviceState } from '../types';

interface BluetoothDeviceWithGATT extends EventTarget {
  name?: string;
  id: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<BluetoothRemoteGATTServer>;
    disconnect: () => void;
  };
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  getPrimaryService: (service: string | number) => Promise<BluetoothRemoteGATTService>;
  disconnect: () => void;
}

interface BluetoothRemoteGATTService {
  getCharacteristic: (characteristic: string | number) => Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  value?: DataView;
  readValue: () => Promise<DataView>;
  startNotifications: () => Promise<BluetoothRemoteGATTCharacteristic>;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  writeValue?: (value: BufferSource) => Promise<void>;
}

export class BluetoothWatchService {
  private device: BluetoothDeviceWithGATT | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private onStateChangeCb: ((state: BluetoothDeviceState) => void) | null = null;

  private state: BluetoothDeviceState = {
    isConnected: false,
    deviceName: null,
    batteryLevel: null,
    heartRate: null,
    isScanning: false,
    error: null,
  };

  subscribe(callback: (state: BluetoothDeviceState) => void) {
    this.onStateChangeCb = callback;
    callback(this.state);
  }

  private updateState(partial: Partial<BluetoothDeviceState>) {
    this.state = { ...this.state, ...partial };
    if (this.onStateChangeCb) {
      this.onStateChangeCb(this.state);
    }
  }

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async connectRealDevice(): Promise<boolean> {
    if (!this.isSupported()) {
      this.updateState({
        error: 'A böngésző nem támogatja a Web Bluetooth API-t (Chrome/Edge/Android Chrome ajánlott).',
      });
      return false;
    }

    try {
      this.updateState({ isScanning: true, error: null });

      const navBluetooth = (navigator as unknown as {
        bluetooth: {
          requestDevice: (options: {
            acceptAllDevices?: boolean;
            optionalServices?: (string | number)[];
          }) => Promise<BluetoothDeviceWithGATT>;
        };
      }).bluetooth;

      const device = await navBluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          'heart_rate',
          'battery_service',
          'alert_notification',
          'immediate_alert',
          '0000180d-0000-1000-8000-00805f9b34fb', // Heart rate
          '0000180f-0000-1000-8000-00805f9b34fb', // Battery
        ],
      });

      this.device = device;
      const deviceName = device.name || 'Bluetooth Okosóra';

      if (!device.gatt) {
        throw new Error('GATT szerver nem elérhető');
      }

      this.server = await device.gatt.connect();

      this.updateState({
        isConnected: true,
        deviceName: deviceName,
        isScanning: false,
        batteryLevel: 88, // fallback or initial estimate
      });

      // Try reading battery service
      try {
        const batteryService = await this.server.getPrimaryService('battery_service');
        const batteryChar = await batteryService.getCharacteristic('battery_level');
        const value = await batteryChar.readValue();
        const level = value.getUint8(0);
        this.updateState({ batteryLevel: level });
      } catch {
        // Battery service might not be exposed on every watch
      }

      // Try reading heart rate service
      try {
        const hrService = await this.server.getPrimaryService('heart_rate');
        const hrChar = await hrService.getCharacteristic('heart_rate_measurement');
        await hrChar.startNotifications();
        hrChar.addEventListener('characteristicvaluechanged', (event: Event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (target.value) {
            const hr = target.value.getUint8(1);
            this.updateState({ heartRate: hr });
          }
        });
      } catch {
        // Heart rate service optional
      }

      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Nem sikerült csatlakozni az okosórához';
      this.updateState({
        isScanning: false,
        error: errorMsg.includes('User cancelled') ? 'Párosítás megszakítva' : errorMsg,
      });
      return false;
    }
  }

  simulateVirtualWatch() {
    this.updateState({
      isConnected: true,
      deviceName: 'Wear OS Okosóra (Szimulált)',
      batteryLevel: 94,
      heartRate: 72,
      isScanning: false,
      error: null,
    });
  }

  disconnect() {
    try {
      if (this.server && this.server.connected) {
        this.server.disconnect();
      }
    } catch {
      // Ignored
    }
    this.device = null;
    this.server = null;
    this.updateState({
      isConnected: false,
      deviceName: null,
      batteryLevel: null,
      heartRate: null,
      isScanning: false,
      error: null,
    });
  }
}

export const bluetoothWatch = new BluetoothWatchService();
