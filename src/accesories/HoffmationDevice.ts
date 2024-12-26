import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { Hoffmation } from '../platform';
import { HoffmationApi } from '../api';
import { DeviceCapability } from 'hoffmation-base/lib/server/devices/DeviceCapability';
import { HoffmationApiDevice } from '../models/hoffmationApi/hoffmationApiDevice';
import { CameraDelegate } from '../CameraHandling/CameraDelegate';
import {
  CurrentDoorState,
  LockCurrentState,
  LockTargetState,
  SmokeDetected,
} from 'hap-nodejs/dist/lib/definitions/CharacteristicDefinitions';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HoffmationDevice {
  private infoService: Service;
  private lightService: Service | undefined;
  private sceneService: Service | undefined;
  private handleService: Service | undefined;
  private motionService: Service | undefined;
  private shutterService: Service | undefined;
  private smokeService: Service | undefined;
  private temperatureService: Service | undefined;
  private cachedDevice: HoffmationApiDevice | undefined;
  private acService: Service | undefined;
  private garageDoorService: Service | undefined;
  /**
   * Last time setBrightness was called, as apple calls both set on and set brightness when changing brightness,
   * so we need to ignore the first call to setOn (in case the setBrightness call fires as well)
   * @type {number}
   * @private
   */
  private lastSetBrightnessCall: number = 0;
  private cameraDelegate: CameraDelegate | undefined;

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
    this.infoService.setCharacteristic(this.platform.Characteristic.SerialNumber, `Hoffmation-${this.device.id}`.substring(0, 60));
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
    if (caps.includes(DeviceCapability.handleSensor)) {
      this.handleService = this.accessory.getService(this.platform.Service.LockMechanism) ||
        this.accessory.addService(this.platform.Service.LockMechanism);
      this.handleService.getCharacteristic(this.platform.Characteristic.LockCurrentState)
        .onGet(this.getHandleCurrentPos.bind(this));
      this.handleService.getCharacteristic(this.platform.Characteristic.LockTargetState)
        .onSet(this.setHandleTargetPos.bind(this))
        .onGet(this.getHandleTargetPos.bind(this));
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
    if (caps.includes(DeviceCapability.garageDoorOpener)) {
      this.garageDoorService = this.accessory.getService(this.platform.Service.GarageDoorOpener) ||
        this.accessory.addService(this.platform.Service.GarageDoorOpener);

      this.garageDoorService.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
        .onGet(this.getGarageDoorCurrentState.bind(this));

      this.garageDoorService.getCharacteristic(this.platform.Characteristic.TargetDoorState)
        .onSet(this.setGarageDoorTargetState.bind(this))
        .onGet(this.getGarageDoorTargetState.bind(this));

      this.garageDoorService.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
        .onGet(() => false);
    }
    if (caps.includes(DeviceCapability.motionSensor)) {
      this.motionService = this.accessory.getService(this.platform.Service.MotionSensor) ||
        this.accessory.addService(this.platform.Service.MotionSensor);
      this.motionService.getCharacteristic(this.platform.Characteristic.MotionDetected)
        .onGet(this.getMotion.bind(this));
    }
    if (caps.includes(DeviceCapability.smokeSensor)) {
      this.smokeService = this.accessory.getService(this.platform.Service.SmokeSensor) ||
        this.accessory.addService(this.platform.Service.SmokeSensor);
      this.smokeService.getCharacteristic(this.platform.Characteristic.SmokeDetected)
        .onGet(this.getSmoke.bind(this));
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
      this.cameraDelegate = new CameraDelegate(this.platform, accessory, this.device, api);
      accessory.configureController(
        this.cameraDelegate.controller,
      );
    }
    if (caps.includes(DeviceCapability.ac)) {
      this.acService = this.accessory.getService(this.platform.Service.HeaterCooler) ||
        this.accessory.addService(this.platform.Service.HeaterCooler);

      this.acService.getCharacteristic(this.platform.Characteristic.Active)
        .onGet(this.getAcOn.bind(this))
        .onSet(this.setAcOn.bind(this));

      this.acService.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
        .onGet(this.getCurrentAcState.bind(this));

      this.acService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getAcTemp.bind(this));
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
    this.cameraDelegate?.updateDeviceData(data);
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
    if (caps.includes(DeviceCapability.handleSensor)) {
      this.handleService?.updateCharacteristic(this.platform.Characteristic.CurrentPosition, data.currentHandlePosition);
    }
    if (caps.includes(DeviceCapability.shutter)) {
      this.shutterService?.updateCharacteristic(this.platform.Characteristic.CurrentPosition, data.currentShutterPosition);
    }
    if (caps.includes(DeviceCapability.garageDoorOpener)) {
      this.garageDoorService?.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, data.currentGarageDoorState);
      this.garageDoorService?.updateCharacteristic(this.platform.Characteristic.TargetDoorState, data.targetGarageDoorState);
    }
    if (caps.includes(DeviceCapability.scene)) {
      this.sceneService?.updateCharacteristic(this.platform.Characteristic.On, data.sceneOn ?? false);
    }
    if (caps.includes(DeviceCapability.ac)) {
      this.acService?.updateCharacteristic(
        this.platform.Characteristic.Active,
        (data.acOn ?? false) ? 1 : 0,
      );
      this.acService?.updateCharacteristic(
        this.platform.Characteristic.CurrentHeaterCoolerState,
        data.currentAcMode === 3 ? this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
          : this.platform.Characteristic.CurrentHeaterCoolerState.HEATING,
      );
      this.acService?.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        data.roomTemperature ?? -99,
      );
    }
  }

  async setBrightness(value: CharacteristicValue) {
    this.platform.log.info('setBrightness ->', value);
    const thisDate: number = Date.now();
    this.lastSetBrightnessCall = thisDate;
    setTimeout(async () => {
      if (thisDate !== this.lastSetBrightnessCall) {
        // Es gab in der Zwischenzeit einen weiteren Aufruf von setBrightness
        return;
      }
      await this.api.setBrightness(this.device.id, value as number);
      await this.updateSelf();
    }, 250);
  }

  async setOn(value: CharacteristicValue) {
    if (this.device.deviceCapabilities.includes(DeviceCapability.dimmablelamp)) {
      this.platform.log.info(`Set Characteristic On for dimmableLamp ${this.device.id} ->`, value);
      await this.delayedSetOn(value as boolean);
    } else if (this.device.deviceCapabilities.includes(DeviceCapability.lamp)) {
      this.platform.log.info(`Set Characteristic On for lamp ${this.device.id} ->`, value);
      await this.api.setLamp(this.device.id, value as boolean);
    } else if (this.device.deviceCapabilities.includes(DeviceCapability.actuator)) {
      this.platform.log.info(`Set Characteristic On for actuator ${this.device.id} ->`, value);
      await this.api.setActuator(this.device.id, value as boolean);
    } else if (this.device.deviceCapabilities.includes(DeviceCapability.scene)) {
      this.platform.log.info(`Set Characteristic On for scene ${this.device.id} ->`, value);
      await this.api.setScene(this.device.id, value as boolean);
    }
    await this.updateSelf();
  }

  async setAcOn(value: CharacteristicValue) {
    const boolValue = value as number === 1;
    this.platform.log.info('Set Ac On ->', boolValue);
    await this.api.setAcOn(this.device.id, boolValue);
    await this.updateSelf();
  }

  async setGarageDoorTargetState(value: CharacteristicValue) {
    this.platform.log.info('setGarageDoorTargetState ->', value);
    await this.api.setGarageDoor(this.device.id, (value as number) === 0);
    await this.updateSelf();
  }

  async setHandleTargetPos(value: CharacteristicValue) {
    this.platform.log.info('setHandleTargetPos ->', value);
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

  async getSmoke(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.smokeSensor)) {
      return SmokeDetected.SMOKE_NOT_DETECTED;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.smokeDetected ? SmokeDetected.SMOKE_DETECTED : SmokeDetected.SMOKE_NOT_DETECTED;
    }

    const update = await this.updateSelf();
    if (!update) {
      return SmokeDetected.SMOKE_NOT_DETECTED;
    }
    return this.getSmoke();
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

  async getAcOn(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.ac)) {
      return false;
    }
    if (this.cachedDevice !== undefined) {
      return (this.cachedDevice.acOn ?? false) ? 1 : 0;
    }

    const update = await this.updateSelf();
    if (!update) {
      return false;
    }
    return this.getAcOn();
  }

  async getCurrentAcState(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.ac)) {
      return false;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.currentAcMode === 3
        ? this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
        : this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    }

    const update = await this.updateSelf();
    if (!update) {
      return false;
    }
    return this.getCurrentAcState();
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
      return Math.min(Math.max(0, this.cachedDevice.brightness ?? 0), 100);
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

  async getHandleTargetPos(): Promise<CharacteristicValue> {
    return LockTargetState.SECURED;
  }

  async getHandleCurrentPos(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.handleSensor)) {
      return LockCurrentState.UNKNOWN;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.currentHandlePosition;
    }const update = await this.updateSelf();
    if (!update) {
      return LockCurrentState.UNKNOWN;
    }
    return this.getHandleCurrentPos();
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

  async getGarageDoorCurrentState(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.garageDoorOpener)) {
      return CurrentDoorState.STOPPED;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.currentGarageDoorState;
    }

    const update = await this.updateSelf();
    if (!update) {
      return CurrentDoorState.STOPPED;
    }
    return this.getGarageDoorCurrentState();
  }

  async getGarageDoorTargetState(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.garageDoorOpener)) {
      return CurrentDoorState.OPEN;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.targetGarageDoorState;
    }

    const update = await this.updateSelf();
    if (!update) {
      return CurrentDoorState.OPEN;
    }
    return this.getGarageDoorTargetState();
  }

  async getAcTemp(): Promise<CharacteristicValue> {
    if (!this.device.deviceCapabilities.includes(DeviceCapability.ac)) {
      return -99;
    }
    if (this.cachedDevice !== undefined) {
      return this.cachedDevice.roomTemperature;
    }

    const update = await this.updateSelf();
    if (!update) {
      return -99;
    }
    return this.getAcTemp();
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

  async delayedSetOn(value: boolean): Promise<void> {
    if (!value) {
      await this.api.setLamp(this.device.id, value);
      return;
    }
    if (Date.now() - this.lastSetBrightnessCall < 400) {
      this.platform.log('Ignoring setOn call as it was called less than 400ms after setBrightness');
      return;
    }
    setTimeout(() => {
        if (Date.now() - this.lastSetBrightnessCall < 500) {
          this.platform.log('Ignoring setOn call as within 400ms of this setBrightness got called');
          return;
        }
        this.api.setLamp(this.device.id, value);
      },
      400,
    );
  }
}
