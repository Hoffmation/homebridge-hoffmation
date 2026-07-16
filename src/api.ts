import * as http from 'http';
import { HoffmationConfig } from './models/config';
import { HoffmationApiDevice } from './models/hoffmationApi/hoffmationApiDevice';
import { Logger } from 'homebridge';

export class HoffmationApi {
  public readonly serverAddress: string;
  private readonly apiToken?: string;

  public constructor(
    config: HoffmationConfig,
    private readonly log: Logger,
  ) {
    this.serverAddress = config.serverAddress;
    this.apiToken = config.apiToken;
  }

  public async getDevices(): Promise<HoffmationApiDevice[]> {
    const data = (await this.performGetObjectRequest(`${this.serverAddress}/devices`)) as { [id: string]: unknown };
    const result: HoffmationApiDevice[] = [];
    for (const key of Object.keys(data)) {
      result.push(new HoffmationApiDevice(data[key] as { [key: string]: unknown }));
    }
    return result;
  }

  public async getDevice(id: string): Promise<HoffmationApiDevice | null> {
    const data = (await this.performGetObjectRequest(`${this.serverAddress}/devices/${id}`)) as unknown | null;
    if (!data) {
      return null;
    }
    return new HoffmationApiDevice(data as { [key: string]: unknown });
  }

  public async setActuator(id: string, desiredState: boolean): Promise<string> {
    const result = await this.performGetStringRequest(`${this.serverAddress}/actuator/${id}/${desiredState}`);
    this.log.debug(`setActuator ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setAcOn(id: string, desiredState: boolean): Promise<string> {
    const result = await this.performGetStringRequest(`${this.serverAddress}/ac/${id}/power/${desiredState}`);
    this.log.debug(`set AC ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setScene(id: string, desiredState: boolean): Promise<string> {
    const url = `${this.serverAddress}/scene/${id}/${desiredState ? 'start/0' : 'end'}`;
    const result = await this.performGetStringRequest(url);
    this.log.debug(`setScene ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setLamp(id: string, desiredState: boolean): Promise<string> {
    const result = await this.performGetStringRequest(`${this.serverAddress}/lamps/${id}/${desiredState}`);
    this.log.debug(`Set Lamp ${id} to ${desiredState} with result ${result}`);
    return result;
  }

  public async setBrightness(id: string, desiredBrightness: number): Promise<string> {
    const state = desiredBrightness > 0;
    const result = await this.performGetStringRequest(
      `${this.serverAddress}/dimmer/${id}/${state}/${desiredBrightness}`,
    );
    this.log.debug(`Set Brightness ${id} to ${desiredBrightness} with result ${result}`);
    return result;
  }

  public async setGarageDoor(id: string, open: boolean): Promise<string> {
    const result = await this.performGetStringRequest(`${this.serverAddress}/garageDoor/${id}/${open}`);
    this.log.debug(`Set Garage Door ${id} to ${open ? 'open' : 'closed'} with result ${result}`);
    return result;
  }

  public async setShuter(id: string, desiredPos: number): Promise<string> {
    const result = await this.performGetStringRequest(`${this.serverAddress}/shutter/${id}/${desiredPos}`);
    this.log.debug(`Set Shutter ${id} to ${desiredPos} with result ${result}`);
    return result;
  }

  private performGetObjectRequest(url: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      this.performGetStringRequest(url)
        .then((data) => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        })
        .catch(reject);
    });
  }

  private performGetStringRequest(url: string): Promise<string> {
    const headers: http.OutgoingHttpHeaders = {
      'user-agent': 'homebridge-hoffmation',
    };
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }
    const reqOptions: http.RequestOptions = { headers };
    return new Promise<string>((resolve, reject) => {
      http.get(url, reqOptions, (res) => {
        const { statusCode } = res;
        if (statusCode === 401) {
          reject(new Error('Hoffmation: Auth failed – check the Bearer token (apiToken in config)'));
          return;
        }
        if (statusCode === 403) {
          reject(new Error('Hoffmation: Access denied – token lacks required role (control or admin)'));
          return;
        }
        if (statusCode !== 200) {
          reject(new Error(`Request Failed.\nStatus Code: ${statusCode}`));
          return;
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

  public async getCameraLastMotionImage(id: string): Promise<Buffer> {
    const result = await this.performGetStringRequest(`${this.serverAddress}/camera/${id}/lastMotionImage`);
    return Buffer.from(result, 'base64');
  }
}
