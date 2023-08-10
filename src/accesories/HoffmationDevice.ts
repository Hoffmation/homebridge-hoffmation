import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { Hoffmation } from '../platform';
import { HoffmationApi } from '../api';
import { DeviceCapability } from 'hoffmation-base/lib/server/devices/DeviceCapability';
import { HoffmationApiDevice } from '../models/hoffmationApi/hoffmationApiDevice';
import { CameraDelegate } from '../CameraHandling/CameraDelegate';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HoffmationDevice {
  private infoService: Service;
  private lightService: Service | undefined;
  private sceneService: Service | undefined;
  private motionService: Service | undefined;
  private shutterService: Service | undefined;
  private temperatureService: Service | undefined;
  private cachedDevice: HoffmationApiDevice | undefined;

  constructor(
    private readonly platform: Hoffmation,
    private readonly accessory: PlatformAccessory,
    private readonly device: HoffmationApiDevice,
    private readonly api: HoffmationApi,
  ) {
    this.accessory.displayName = device.name;
    this.infoService = this.accessory.getService(this.platform.Service.AccessoryInformation) ||
      this.accessory.addService(this.platform.Service.AccessoryInformation);

    this.infoService.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
    this.infoService.setCharacteristic(this.platform.Characteristic.Identify, this.device.id);
    this.infoService.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hoffmation');
    this.infoService.setCharacteristic(this.platform.Characteristic.Model, 'Hoffmation');
    this.infoService.setCharacteristic(this.platform.Characteristic.SerialNumber, `Hoffmation-${this.device.id}`);
    this.infoService.setCharacteristic(this.platform.Characteristic.FirmwareRevision, '1.0.0');

    const caps = device.deviceCapabilities;
    if (caps.includes(DeviceCapability.lamp)) {
      this.lightService = this.accessory.getService(this.platform.Service.Lightbulb) ||
        this.accessory.addService(this.platform.Service.Lightbulb);
      this.lightService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setOn.bind(this))
        .onGet(this.getLightOn.bind(this));

      if (caps.includes(DeviceCapability.dimmablelamp)) {
        this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
          .onSet(this.setBrightness.bind(this))
          .onGet(this.getBrightness.bind(this));
      }

    } else if (caps.includes(DeviceCapability.actuator)) {
      this.lightService = this.accessory.getService(this.platform.Service.Outlet) ||
        this.accessory.addService(this.platform.Service.Outlet);
      this.lightService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setOn.bind(this))
        .onGet(this.getActuatorOn.bind(this));
    }
    if (caps.includes(DeviceCapability.scene)) {
      this.sceneService = this.accessory.getService(this.platform.Service.Switch) ||
        this.accessory.addService(this.platform.Service.Switch);
      this.sceneService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setOn.bind(this))
        .onGet(this.getSceneOn.bind(this));
    }
    if (caps.includes(DeviceCapability.shutter)) {
      this.shutterService = this.accessory.getService(this.platform.Service.WindowCovering) ||
        this.accessory.addService(this.platform.Service.WindowCovering);

      this.shutterService.getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .onGet(this.getShutterCurrentPos.bind(this));

      this.shutterService.getCharacteristic(this.platform.Characteristic.PositionState)
        .onGet(() => this.platform.Characteristic.PositionState.STOPPED);

      this.shutterService.getCharacteristic(this.platform.Characteristic.TargetPosition)
        .onSet(this.setShutterTargetPos.bind(this))
        .onGet(this.getShutterCurrentPos.bind(this));
    }
    if (caps.includes(DeviceCapability.motionSensor)) {
      this.motionService = this.accessory.getService(this.platform.Service.MotionSensor) ||
        this.accessory.addService(this.platform.Service.MotionSensor);
      this.motionService.getCharacteristic(this.platform.Characteristic.MotionDetected)
        .onGet(this.getMotion.bind(this));
    }
    if (caps.includes(DeviceCapability.temperatureSensor)) {
      this.temperatureService = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
        this.accessory.addService(this.platform.Service.TemperatureSensor);
      this.temperatureService.setCharacteristic(
        this.platform.Characteristic.TemperatureDisplayUnits,
        this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
      );
      this.temperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getTemperature.bind(this));
    }
    if (caps.includes(DeviceCapability.camera)) {
      const delegate = new CameraDelegate(this.platform, accessory, this.device)
      accessory.configureController(
        delegate.controller,
      );
    }
  }

  public async updateSelf(): Promise<HoffmationApiDevice | null> {
    const data = await this.api.getDevice(this.device.id);
    this.processUpdate(data);
    return data;
  }

  public processUpdate(data: HoffmationApiDevice | null) {
    if (data === null) {
      return;
    }
    this.cachedDevice = data;
    const caps = this.device.deviceCapabilities;
    if (caps.includes(DeviceCapability.lamp)) {
      this.lightService?.updateCharacteristic(this.platform.Characteristic.On, data.lightOn ?? false);
    } else if (caps.includes(DeviceCapability.actuator)) {
      this.lightService?.updateCharacteristic(this.platform.Characteristic.On, data.actuatorOn ?? false);
    }
    if (caps.includes(DeviceCapability.motionSensor)) {
      this.motionService?.updateCharacteristic(this.platform.Characteristic.MotionDetected, data.movementDetected);
    }
    if (caps.includes(DeviceCapability.temperatureSensor)) {
      this.temperatureService?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, data.temperature);
    }
    if (caps.includes(DeviceCapability.shutter)) {
      this.shutterService?.updateCharacteristic(this.platform.Characteristic.CurrentPosition, data.currentShutterPosition);
    }
  }

  async setBrightness(value: CharacteristicValue) {
    this.platform.log.info('setBrightness ->', value);
    await this.api.setBrightness(this.device.id, value as number);
    await this.updateSelf();
  }

  async setOn(value: CharacteristicValue) {
    this.platform.log.info('Set Characteristic On ->', value);
    if (this.device.deviceCapabilities.includes(DeviceCapability.lamp)) {
      await this.api.setLamp(this.device.id, value as boolean);
    } else if (this.device.deviceCapabilities.includes(DeviceCapability.actuator)) {
      await this.api.setActuator(this.device.id, value as boolean);
    } else if (this.device.deviceCapabilities.includes(DeviceCapability.scene)) {
      await this.api.setScene(this.device.id, value as boolean);
    }
    await this.updateSelf();
  }

  async setShutterTargetPos(value: CharacteristicValue) {
    this.platform.log.info('setShutterTargetPos ->', value);
    await this.api.setShuter(this.device.id, value as number);
    await this.updateSelf();
  }

  async getMotion(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.motionSensor)) {
      return false;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.movementDetected;
    }

    const update = await this.updateSelf();
    if (!update) {
      return false;
    }
    return this.getMotion();
  }

  async getActuatorOn(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.actuator)) {
      return false;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.actuatorOn ?? false;
    }

    const update = await this.updateSelf();
    if (!update) {
      return false;
    }
    return this.getActuatorOn();
  }

  async getSceneOn(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.scene)) {
      return false;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.sceneOn ?? false;
    }

    const update = await this.updateSelf();
    if (!update) {
      return false;
    }
    return this.getSceneOn();
  }

  async getBrightness(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.dimmablelamp)) {
      return false;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.brightness ?? 0;
    }

    const update = await this.updateSelf();
    if (!update) {
      return false;
    }
    return this.getBrightness();
  }

  async getLightOn(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.lamp)) {
      return false;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.lightOn ?? false;
    }

    const update = await this.updateSelf();
    if (!update) {
      return false;
    }
    return this.getLightOn();
  }

  async getShutterCurrentPos(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.shutter)) {
      return 0;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.currentShutterPosition;
    }

    const update = await this.updateSelf();
    if (!update) {
      return 0;
    }
    return this.getShutterCurrentPos();
  }

  async getTemperature(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.temperatureSensor)) {
      return -99;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.temperature;
    }

    const update = await this.updateSelf();
    if (!update) {
      return -99;
    }
    return this.getTemperature();
  }

}
