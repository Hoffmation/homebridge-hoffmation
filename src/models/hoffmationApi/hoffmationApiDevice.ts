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


  public get lightOn(): boolean {
    return (this.rawData['_actuatorOn'] ??
      this.rawData['actuatorOn'] ??
      this.rawData['_lightOn'] ??
      this.rawData['lightOn']) as boolean ??
      false;
  }

  public constructor(
    private readonly rawData: { [key: string]: unknown },
  ) {
  }
}
