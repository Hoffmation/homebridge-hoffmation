import * as http from 'http';
import { HoffmationConfig } from './models/config';
import { HoffmationApiDevice } from './models/hoffmationApi/hoffmationApiDevice';
import { Logger } from 'homebridge';

export class HoffmationApi {
  private readonly serverAddress: string;

  public constructor(
    config: HoffmationConfig,
    private readonly log: Logger,
  ) {
    this.serverAddress = config.serverAddress;
  }

  public async getDevices(): Promise<HoffmationApiDevice[]> {
    const data = await HoffmationApi.performGetObjectRequest(`${this.serverAddress}/devices`) as { [id: string]: unknown };
    const result: HoffmationApiDevice[] = [];
    for (const key of Object.keys(data)) {
      result.push(new HoffmationApiDevice(data[key] as { [key: string]: unknown }));
    }
    return result;
  }

  public async getDevice(id: string): Promise<HoffmationApiDevice | null> {
    const data = await HoffmationApi.performGetObjectRequest(`${this.serverAddress}/devices/${id}`) as unknown | null;
    if (!data) {
      return null;
    }
    return new HoffmationApiDevice(data as { [key: string]: unknown });
  }

  public async setActuator(id: string, desiredState: boolean): Promise<string> {
    const result = await HoffmationApi.performGetStringRequest(`${this.serverAddress}/actuator/${id}/${desiredState}`);
    this.log.debug(`setActuator ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setAcOn(id: string, desiredState: boolean): Promise<string> {
    const result = await HoffmationApi.performGetStringRequest(`${this.serverAddress}/ac/${id}/power/${desiredState}`);
    this.log.debug(`set AC ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setScene(id: string, desiredState: boolean): Promise<string> {
    const url = `${this.serverAddress}/scene/${id}/${(desiredState ? 'start/0' : 'end')}`;
    const result = await HoffmationApi.performGetStringRequest(url);
    this.log.debug(`setScene ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setLamp(id: string, desiredState: boolean): Promise<string> {
    const result = await HoffmationApi.performGetStringRequest(`${this.serverAddress}/lamps/${id}/${desiredState}`);
    this.log.debug(`Set Lamp ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setBrightness(id: string, desiredBrightness: number): Promise<string> {
    const state = desiredBrightness > 0;
    const result =
      await HoffmationApi.performGetStringRequest(`${this.serverAddress}/dimmer/${id}/${state}/${desiredBrightness}`);
    this.log.debug(`Set Brightness ${id} to ${desiredBrightness} with result ${result}`);
    return result;
  }

  public async setShuter(id: string, desiredPos: number): Promise<string> {
    const result = await HoffmationApi.performGetStringRequest(`${this.serverAddress}/shutter/${id}/${desiredPos}`);
    this.log.debug(`Set Shutter ${id} to ${desiredPos} with result ${result}`);
    return result;
  }

  public static performGetObjectRequest(url: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      HoffmationApi.performGetStringRequest(url).then((data) => {
        try {
          const parsedData = JSON.parse(data);
          resolve(parsedData);
        } catch (e) {
          reject(e);
        }
      }).catch((err) => {
        reject(err);
      });
    });
  }

  public static performGetStringRequest(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      http.get(url, (res) => {
        const {statusCode} = res;

        if (statusCode !== 200) {
          reject(new Error(`Request Failed.\nStatus Code: ${statusCode}`));
        }
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          resolve(rawData);
        });
      });
    });
  }
}
