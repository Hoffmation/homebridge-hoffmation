import { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HoffmationDevice } from './accesories/HoffmationDevice';
import { HoffmationConfig } from './models/config';
import { HoffmationApi } from './api';
import { DeviceCapability } from 'hoffmation-base/lib/server/devices/DeviceCapability';
import { HoffmationApiDevice } from './models/hoffmationApi/hoffmationApiDevice';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class Hoffmation implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  private readonly _api: HoffmationApi;
  private devicesDict: { [id: string]: HoffmationDevice } = {};

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform: ', this.config.name);
    this._api = new HoffmationApi(this.config as HoffmationConfig, this.log);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {

    this._api.getDevices().catch((err) => {
      this.log.error('Failed to get devices', err);
    }).then((devices) => {
      if (!devices) {
        this.log.error('No devices found');
        return;
      }

      this.log.info(`Connection established got ${devices.length} devices`);
      this.processDevices(devices);
      setInterval(this.updateAllDevices.bind(this), 15000);
    });
  }

  private async updateAllDevices(): Promise<void> {
    const devices = await this._api.getDevices();
    if (!devices || devices.length === 0) {
      this.log.error('No devices found');
      return;
    }
    for (const device of devices) {
      this.devicesDict[device.id]?.processUpdate(device);
    }
  }

  private processDevices(devices: HoffmationApiDevice[]): void {
    // loop over the discovered devices and register each one if it has not already been registered
    const usedIds: string[] = [];

    for (const device of devices) {
      this.log.debug(`Processing ${device.id} with capabilities ${device.deviceCapabilities}`);
      if (!this.shouldIncludeDevice(device)) {
        continue;
      }
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.id);
      usedIds.push(uuid);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory !== undefined) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        existingAccessory.displayName = device.name;

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        this.devicesDict[device.id] = new HoffmationDevice(this, existingAccessory, device, this._api);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        continue;
      }

      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', device.name);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.name, uuid);

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      this.devicesDict[device.id] = new HoffmationDevice(this, accessory, device, this._api);

      // link the accessory to your platform
      if (device.deviceCapabilities.includes(DeviceCapability.camera)) {
        this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
      } else {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    this.api.unregisterPlatformAccessories(
      PLUGIN_NAME,
      PLATFORM_NAME,
      this.accessories.filter((accessory) => !usedIds.includes(accessory.UUID)));
  }

  private shouldIncludeDevice(device: HoffmationApiDevice): boolean {
    const config = this.config as HoffmationConfig;
    if (device.deviceCapabilities.includes(DeviceCapability.ac) && config.useAcDevices) {
      return true;
    }
    if (device.deviceCapabilities.includes(DeviceCapability.actuator) && config.useActuatorDevices) {
      return true;
    }
    if (device.deviceCapabilities.includes(DeviceCapability.camera) && config.useCameraDevices) {
      return true;
    }
    if (device.deviceCapabilities.includes(DeviceCapability.lamp) && config.useLampDevices) {
      return true;
    }
    if (device.deviceCapabilities.includes(DeviceCapability.motionSensor) &&
      !device.deviceCapabilities.includes(DeviceCapability.camera) &&
      config.useMotionSensorDevices
    ) {
      return true;
    }
    if (device.deviceCapabilities.includes(DeviceCapability.scene) && config.useSceneDevices) {
      return true;
    }
    if (device.deviceCapabilities.includes(DeviceCapability.shutter) && config.useShutterDevices) {
      return true;
    }
    if (device.deviceCapabilities.includes(DeviceCapability.temperatureSensor) && config.useTemperatureDevices) {
      return true;
    }
    return false;
  }
}
