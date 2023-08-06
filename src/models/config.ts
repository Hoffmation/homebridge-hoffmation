import { PlatformConfig } from "homebridge";

export interface HoffmationConfig extends PlatformConfig {
  readonly name: string;
  readonly serverAddress: string;
}
