import { PlatformConfig } from "homebridge";

export interface HoffmationConfig extends PlatformConfig {
  readonly name: string;
  readonly serverAddress: string;
  readonly useRtspStream: boolean;
  readonly useAcDevices: boolean;
  readonly useActuatorDevices: boolean;
  readonly useCameraDevices: boolean;
  readonly useGarageDoorDevices: boolean;
  readonly useLampDevices: boolean;
  readonly useMotionSensorDevices: boolean;
  readonly useSceneDevices: boolean;
  readonly useShutterDevices: boolean;
  readonly useTemperatureDevices: boolean;
}
