import { DeviceCapability } from 'hoffmation-base/lib/server/devices/DeviceCapability';
import { HoffmationApiDeviceInfo } from './HoffmationApiDeviceInfo';

export class HoffmationApiDevice {

  public get deviceCapabilities(): DeviceCapability[] {
    return (this.rawData['_deviceCapabilities'] ?? this.rawData['deviceCapabilities']) as DeviceCapability[] ?? [];
  }

  public get info(): HoffmationApiDeviceInfo {
    return (this.rawData['_info'] ?? this.rawData['info'] ) as HoffmationApiDeviceInfo;
  }

  public get id(): string {
    return this.info.allDevicesKey ?? this.info.fullID ?? this.info.fullName;
  }

  public get name(): string {
    return this.info._customName ?? this.info.fullName;
  }


  public get currentShutterPosition(): number {
    return (this.rawData['_currentLevel']) as number ?? 0;
  }


  public get actuatorOn(): boolean | undefined {
    return (this.rawData['_actuatorOn'] ??
      this.rawData['actuatorOn']) as boolean | undefined;
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


  public get temperature(): number {
    return (this.rawData['_temperature']) as number ?? -99;
  }

  public constructor(
    private readonly rawData: { [key: string]: unknown },
  ) {
  }
}
