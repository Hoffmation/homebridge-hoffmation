import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Server, Socket } from 'node:net';
import { createServer } from 'node:net';
import type { Readable } from 'node:stream';

import {
  APIEvent,
  AudioRecordingCodecType,
  CameraController,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  CameraRecordingOptions,
  H264Level,
  H264Profile,
  HDSProtocolSpecificErrorReason,
  Logging,
  PlatformAccessory,
  RecordingPacket,
} from 'homebridge';

import { Mp4Session, PreBuffer } from './PreBuffer';

import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { env } from 'node:process';

import { Hoffmation } from '../platform';
import { VideoConfig } from './VideoConfig';
import { HoffmationApiDevice } from '../models/hoffmationApi/hoffmationApiDevice';


export interface MP4Atom {
  header: Buffer;
  length: number;
  type: string;
  data: Buffer;
}

export interface FFMpegFragmentedMP4Session {
  socket: Socket;
  cp: ChildProcess;
  generator: AsyncGenerator<MP4Atom>;
}

export const PREBUFFER_LENGTH = 4000;
export const FRAGMENTS_LENGTH = 4000;

export async function listenServer(server: Server, log: Logging): Promise<number> {
  let isListening = false;
  while (!isListening) {
    const port = 10000 + Math.round(Math.random() * 30000);
    server.listen(port);
    try {
      await once(server, 'listening');
      isListening = true;
      const address = server.address();
      if (address && typeof address === 'object' && 'port' in address) {
        return address.port;
      }
      throw new Error('Failed to get server address');
    } catch (e: unknown) {
      log.error('Error while listening to the server:', e);
    }
  }
  // Add a return statement to ensure the function always returns a number
  return 0;
}

export async function readLength(readable: Readable, length: number): Promise<Buffer> {
  if (!length) {
    return Buffer.alloc(0);
  }

  {
    const ret = readable.read(length);
    if (ret) {
      return ret;
    }
  }

  return new Promise((resolve, reject) => {
    const r = (): void => {
      const ret = readable.read(length);
      if (ret) {
        cleanup();
        resolve(ret);
      }
    };

    const e = (): void => {
      cleanup();
      reject(new Error(`stream ended during read for minimum ${length} bytes`));
    };

    const cleanup = (): void => {
      readable.removeListener('readable', r);
      readable.removeListener('end', e);
    };

    readable.on('readable', r);
    readable.on('end', e);
  });
}

export async function* parseFragmentedMP4(readable: Readable): AsyncGenerator<MP4Atom> {
  while (true) {
    const header = await readLength(readable, 8);
    const length = header.readInt32BE(0) - 8;
    const type = header.slice(4).toString();
    const data = await readLength(readable, length);

    yield {
      header,
      length,
      type,
      data,
    };
  }
}

export class RecordingDelegate implements CameraRecordingDelegate {
  private transmittedSegments: number = 0;
  private isRecording: boolean = false;
  private isInitialized: boolean = false;
  private readonly log: Logging;
  private readonly cameraName: string;
  private process!: ChildProcess;

  private readonly videoProcessor: string;
  readonly controller?: CameraController;
  private preBufferSession?: Mp4Session;
  private preBuffer?: PreBuffer;
  private recordingConfiguration?: CameraRecordingConfiguration;
  private sessions: Map<number, FFMpegFragmentedMP4Session> = new Map();

  constructor(
    private readonly platform: Hoffmation,
    private readonly device: HoffmationApiDevice,
    private readonly accessory: PlatformAccessory,
    private readonly videoConfig: VideoConfig,
    videoProcessor: string,
    private readonly recordingOptions: CameraRecordingOptions,
  ) {
    this.log = platform.log;
    this.cameraName = device.name;
    this.videoProcessor = videoProcessor;

    platform.api.on(APIEvent.SHUTDOWN, () => {
      if (this.preBufferSession) {
        this.preBufferSession.process?.kill();
        this.preBufferSession.server?.close();
      }
    });
  }

  updateRecordingActive(active: boolean): Promise<void> {
    this.log.info(`Recording active status changed to: ${active}`, this.cameraName);
    this.isRecording = active;
    return Promise.resolve();
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): Promise<void> {
    this.log.info('Recording configuration updated', this.cameraName);
    this.recordingConfiguration = configuration;
    return Promise.resolve();
  }

  async* handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    // The first transmitted segment in an fMP4 stream is always the initialization segment and contains no video, so we don't count it.
    this.transmittedSegments = 0;

    if (this.accessory.context.hksvRecording && this.isRecording && !this.preBuffer) {

      await this.updateRecordingActive(this.isRecording);
    }
    if(this.sessions.has(streamId)) {
      this.closeRecordingStream(streamId, HDSProtocolSpecificErrorReason.BUSY);
    }
    const session: FFMpegFragmentedMP4Session = await this.startSession();
    this.sessions.set(streamId, session);
    yield* this.yieldSessionFragments(session);
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    this.log.info(`Recording stream closed for stream ID: ${streamId}, reason: ${reason}`, this.cameraName);
    if (!this.sessions.has(streamId)) {
      return;
    }

    const session = this.sessions.get(streamId);
    if (session) {
      this.sessions.delete(streamId);
      session.cp.kill();
      session.socket.destroy();
    }
  }

  async startPreBuffer(): Promise<void> {
    this.log.info(`start prebuffer ${this.cameraName}, prebuffer: ${this.videoConfig?.prebuffer}`);
    if (this.videoConfig?.prebuffer) {
      // looks like the setupAcessory() is called multiple times during startup. Ensure that Prebuffer runs only once
      if (!this.preBuffer) {
        this.preBuffer = new PreBuffer(this.log, this.videoConfig.source ?? '', this.cameraName, this.videoProcessor);
        if (!this.preBufferSession) {
          this.preBufferSession = await this.preBuffer.startPreBuffer();
        }
      }
    }
  }

  async* handleFragmentsRequests(configuration: CameraRecordingConfiguration): AsyncGenerator<RecordingPacket> {
    this.log.debug('video fragments requested', this.cameraName);
    const session: FFMpegFragmentedMP4Session = await this.startSession(configuration);

    yield* this.yieldSessionFragments(session);
  }

  async* yieldSessionFragments(session: FFMpegFragmentedMP4Session): AsyncGenerator<RecordingPacket> {
    const {socket, cp, generator} = session;
    let pending: Array<Buffer> = [];
    let filebuffer: Buffer = Buffer.alloc(0);
    try {
      for await (const box of generator) {
        const {header, type, length, data} = box;

        pending.push(header, data);

        if (type === 'moov' || type === 'mdat') {
          const fragment = Buffer.concat(pending);
          filebuffer = Buffer.concat([filebuffer, Buffer.concat(pending)]);
          pending = [];
          yield {data: fragment, isLast: false};
        }
        this.log.debug(`mp4 box type ${type} and length: ${length}`, this.cameraName);
      }
      yield {data: Buffer.alloc(1, 0), isLast: true};
    } catch (e) {
      this.log.info(`Recoding completed. ${e}`, this.cameraName);
      /*
            const homedir = require('os').homedir();
            const path = require('path');
            const writeStream = fs.createWriteStream(homedir+path.sep+Date.now()+'_video.mp4');
            writeStream.write(filebuffer);
            writeStream.end();
            */
    } finally {
      socket.destroy();
      cp.kill();
      // this.server.close;
    }
  }

  private async startSession(
    configuration?: CameraRecordingConfiguration,
    iframeIntervalSeconds: number = 4,
  ): Promise<FFMpegFragmentedMP4Session> {
    configuration ??= this.recordingConfiguration
    if (!configuration) {
      throw new Error('No configuration provided');
    }
    const audioArgs: Array<string> = [
      '-acodec',
      'libfdk_aac',
      ...(configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC
        ? ['-profile:a', 'aac_low']
        : ['-profile:a', 'aac_eld']),
      '-ar',
      `${configuration.audioCodec.samplerate}k`,
      '-b:a',
      `${configuration.audioCodec.bitrate}k`,
      '-ac',
      `${configuration.audioCodec.audioChannels}`,
    ];

    const profile = configuration.videoCodec.parameters.profile === H264Profile.HIGH
      ? 'high'
      : configuration.videoCodec.parameters.profile === H264Profile.MAIN ? 'main' : 'baseline';

    const level = configuration.videoCodec.parameters.level === H264Level.LEVEL4_0
      ? '4.0'
      : configuration.videoCodec.parameters.level === H264Level.LEVEL3_2 ? '3.2' : '3.1';

    const videoArgs: Array<string> = [
      '-an',
      '-sn',
      '-dn',
      '-codec:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',

      '-profile:v',
      profile,
      '-level:v',
      level,
      '-b:v',
      `${configuration.videoCodec.parameters.bitRate}k`,
      `${iframeIntervalSeconds > 0 ? `-force_key_frames expr:eq(t,n_forced*${iframeIntervalSeconds})` : ''}`,
      '-r',
      configuration.videoCodec.resolution[2].toString(),
    ];

    const ffmpegInput: Array<string> = [];

    if (this.videoConfig?.prebuffer) {
      const input: Array<string> =
        this.preBuffer ? await this.preBuffer.getVideo(configuration.mediaContainerConfiguration.fragmentLength ?? PREBUFFER_LENGTH) : [];
      ffmpegInput.push(...input);
    } else {
      ffmpegInput.push(...(this.videoConfig?.source ?? '').split(' '));
    }

    this.log.debug('Start recording...', this.cameraName);

    const session = await this.startFFMPegFragmetedMP4Session(this.videoProcessor, ffmpegInput, audioArgs, videoArgs);
    this.log.info('Recording started', this.cameraName);
    return session;
  }

  async startFFMPegFragmetedMP4Session(ffmpegPath: string, ffmpegInput: Array<string>, audioOutputArgs: Array<string>, videoOutputArgs: Array<string>): Promise<FFMpegFragmentedMP4Session> {
    return new Promise((resolve) => {
      const server = createServer((socket) => {
        server.close();

        async function* generator(): AsyncGenerator<MP4Atom> {
          while (true) {
            const header = await readLength(socket, 8);
            const length = header.readInt32BE(0) - 8;
            const type = header.slice(4).toString();
            const data = await readLength(socket, length);

            yield {
              header,
              length,
              type,
              data,
            };
          }
        }

        const cp = this.process;
        resolve({
          socket,
          cp,
          generator: generator(),
        });
      });

      listenServer(server, this.log).then((serverPort) => {
        const args: Array<string> = [];

        args.push(...ffmpegInput);

        // args.push(...audioOutputArgs);

        args.push('-f', 'mp4');
        args.push(...videoOutputArgs);
        args.push('-fflags', '+genpts', '-reset_timestamps', '1');
        args.push(
          '-movflags',
          'frag_keyframe+empty_moov+default_base_moof',
          `tcp://127.0.0.1:${serverPort}`,
        );
        args.push(' -loglevel level' + (this.videoConfig.debug ? '+verbose' : ''))

        this.log.debug(`${ffmpegPath} ${args.join(' ')}`, this.cameraName);

        const debug: boolean = this.videoConfig.debug ?? false;

        const stdioValue = debug ? 'pipe' : 'ignore';
        this.process = spawn(ffmpegPath, args, {env, stdio: stdioValue});
        const cp = this.process;

        if (debug) {
          if (cp.stdout) {
            cp.stdout.on('data', (data: Buffer) => this.log.debug(data.toString(), this.cameraName));
          }
          if (cp.stderr) {
            cp.stderr.on('data', (data: Buffer) => this.log.debug(data.toString(), this.cameraName));
          }
        }
      });
    });
  }
}
