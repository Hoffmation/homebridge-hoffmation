import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { Hoffmation } from '../platform';
import { iBaseDevice, iLamp } from 'hoffmation-base';
import { HoffmationApi } from '../api';
import { DeviceCapability } from 'hoffmation-base/lib/server/devices/DeviceCapability';
import { HoffmationApiDevice } from '../models/hoffmationApi/hoffmationApiDevice';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HoffmationLamp {
  private service: Service;

  constructor(
    private readonly platform: Hoffmation,
    private readonly accessory: PlatformAccessory,
    private readonly device: HoffmationApiDevice,
    private readonly api: HoffmationApi,
  ) {
    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.info.fullName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));               // GET - bind to the `getOn` method below

    setInterval(this.update.bind(this), 10000);
  }

  private update() {
    this.api.getDevice(this.device.id).then((update: HoffmationApiDevice | null) => {
      if (!update) {
        return;
      }
      if (!update.deviceCapabilities.includes(DeviceCapability.lamp)) {
        return;
      }

      this.service.updateCharacteristic(this.platform.Characteristic.On, update.lightOn);
    });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    this.platform.log.info('Set Characteristic On ->', value);
    await this.api.setLamp(this.device.id, value as boolean);
    this.update();
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    const update = await this.api.getDevice(this.device.id);
    if (!update) {
      return false;
    }
    if (!update.deviceCapabilities.includes(DeviceCapability.lamp)) {
      return false;
    }
    return update.lightOn;
  }

}
