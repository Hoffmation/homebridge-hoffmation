import { DeviceCapability } from 'hoffmation-base/lib/server/devices/DeviceCapability';
import { HoffmationApiDeviceInfo } from './HoffmationApiDeviceInfo';

export class HoffmationApiDevice {
  public get rtspUrl(): string {
    return (this.rawData['rtspStreamLink']) as string ?? '';
  }

  public get h264IosStreamLink(): string {
    return (this.rawData['h264IosStreamLink']) as string ?? '';
  }

  public get snapshotUrl(): string {
    return (this.rawData['currentImageLink'] as string) ?? '';
  }

  public get deviceCapabilities(): DeviceCapability[] {
    return (this.rawData['_deviceCapabilities'] ?? this.rawData['deviceCapabilities']) as DeviceCapability[] ?? [];
  }

  public get info(): HoffmationApiDeviceInfo {
    return (this.rawData['_info'] ?? this.rawData['info']) as HoffmationApiDeviceInfo;
  }

  public get id(): string {
    return this.info.allDevicesKey ?? this.info.fullID ?? this.info.fullName;
  }

  public get name(): string {
    return this.info._customName ?? this.info.fullName;
  }


  public get currentShutterPosition(): number {
    return Math.max(Math.min((this.rawData['_currentLevel']) as number ?? 0, 100), 0);
  }


  public get actuatorOn(): boolean | undefined {
    return (this.rawData['_actuatorOn'] ??
      this.rawData['actuatorOn']) as boolean | undefined;
  }

  public get acOn(): boolean | undefined {
    return (this.rawData['_on'] ??
      this.rawData['on']) as boolean | undefined;
  }


  public get sceneOn(): boolean | undefined {
    return (this.rawData['_on'] ??
      this.rawData['on']) as boolean | undefined;
  }


  public get brightness(): boolean | undefined {
    return (this.rawData['brightness'] ??
      this.rawData['_brightness']) as boolean | undefined;
  }


  public get lightOn(): boolean | undefined {
    return (this.actuatorOn ??
      this.rawData['_lightOn'] ??
      this.rawData['lightOn']) as boolean | undefined;
  }


  public get movementDetected(): boolean {
    return (this.rawData['movementDetected'] ??
        this.rawData['_movementDetected']) as boolean ??
      false;
  }

  public get currentAcMode(): number {
    return (this.rawData['desiredMode']) as number ?? 0;
  }

  public get roomTemperature(): number {
    return (this.rawData['_roomTemperature']) as number ?? -99;
  }

  public get temperature(): number {
    return (this.rawData['_temperature']) as number ?? -99;
  }

  public constructor(
    private readonly rawData: { [key: string]: unknown },
  ) {
  }
}
