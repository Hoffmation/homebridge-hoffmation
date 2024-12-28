import { DeviceCapability } from 'hoffmation-base/lib/server/devices/DeviceCapability';
import { HoffmationApiDeviceInfo } from './HoffmationApiDeviceInfo';
import { CurrentDoorState, LockCurrentState, TargetDoorState } from 'hap-nodejs/dist/lib/definitions/CharacteristicDefinitions';

export class HoffmationApiDevice {
  public get rtspUrl(): string {
    return (this.rawData['rtspStreamLink']) as string ?? '';
  }

  public get cameraHasAudio(): boolean {
    return (this.rawData['settings']?.['hasAudio']) as boolean ?? false;
  }

  public get cameraHasSpeaker(): boolean {
    return (this.rawData['settings']?.['hasSpeaker']) as boolean ?? this.cameraHasAudio;
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

  public get lastMotionTimestamp(): number {
    return (this.rawData['_lastMotion']) as number ?? 0;
  }

  public get name(): string {
    return this.info._customName ?? this.info.fullName;
  }


  public get currentShutterPosition(): number {
    return Math.max(Math.min((this.rawData['_currentLevel']) as number ?? 0, 100), 0);
  }

  public get currentHandleNumericPosition(): number {
    return this.rawData['position'] as number ??
      this.rawData['handleSensor']?.['position'] as number ??
      -1;
  }

  public get currentHandlePosition(): number {
    switch (this.currentHandleNumericPosition) {
      case -1:
        return LockCurrentState.UNKNOWN;
      case 0:
        return LockCurrentState.SECURED;
      case 1:
        return LockCurrentState.JAMMED;
      case 2:
        return LockCurrentState.UNSECURED;
    }
    return LockCurrentState.UNKNOWN;
  }

  public get smokeDetected(): boolean {
    return (this.rawData['smoke'] ?? this.rawData['_smoke']) as boolean ?? false;
  }


  public get targetGarageDoorState(): number {
    const isClosed = this.rawData['_switchState'] as boolean | undefined;
    if (isClosed === undefined) {
      return TargetDoorState.OPEN;
    }
    return isClosed ? TargetDoorState.CLOSED : TargetDoorState.OPEN;
  }


  public get currentGarageDoorState(): number {
    const isClosed = this.rawData['_isClosed'] as boolean | undefined;
    if (isClosed === undefined) {
      return CurrentDoorState.STOPPED;
    }
    return isClosed ? CurrentDoorState.CLOSED : CurrentDoorState.OPEN;
  }


  public get actuatorOn(): boolean | undefined {
    return (
      this.rawData['_actuatorOn'] ??
      this.rawData['actuatorOn'] ??
      this.rawData['_on'] ??
      this.rawData['on']
    ) as boolean | undefined;
  }

  public get acOn(): boolean | undefined {
    return (this.rawData['_on'] ??
      this.rawData['on']) as boolean | undefined;
  }


  public get sceneOn(): boolean | undefined {
    return (this.rawData['_on'] ??
      this.rawData['on']) as boolean | undefined;
  }


  public get brightness(): number | undefined {
    return (this.rawData['brightness'] ??
      this.rawData['_brightness']) as number | undefined;
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
    return (this.rawData['temperatureSensor']?.['_roomTemperature']) as number ??
      this.rawData['_roomTemperature'] as number ??
      -99;
  }

  public get temperature(): number {
    return (this.rawData['temperatureSensor']?.['_temperature']) as number ??
      this.rawData['_temperature'] as number ??
      -99;
  }

  public constructor(
    private readonly rawData: { [key: string]: unknown },
  ) {
  }
}
