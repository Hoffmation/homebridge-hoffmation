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
  private isTransmitting: boolean = false;
  private sessions: Map<number, FFMpegFragmentedMP4Session> = new Map();

  constructor(
    private readonly platform: Hoffmation,
    private readonly device: HoffmationApiDevice,
    private readonly accessory: PlatformAccessory,
    private readonly videoConfig: VideoConfig,
    videoProcessor: string,
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

  updateRecordingConfiguration(): Promise<void> {
    this.log.info('Recording configuration updated', this.cameraName);
    return Promise.resolve();
  }

  async* handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    // The first transmitted segment in an fMP4 stream is always the initialization segment and contains no video, so we don't count it.
    this.transmittedSegments = 0;

    // If we are recording HKSV events and we haven't fully initialized our timeshift buffer (e.g. offline cameras preventing us from doing so), then do so now.
    if (this.accessory.context.hksvRecording && this.isRecording && !this.preBuffer) {

      await this.updateRecordingActive(this.isRecording);
    }
    if(!this.sessions.has(streamId)) {
      this.log.error(`No session found for stream-id ${streamId} and camera ${this.cameraName}`);
      return;
    }
    const session: FFMpegFragmentedMP4Session = this.sessions.get(streamId)!;
    // Process our FFmpeg-generated segments and send them back to HKSV.
    for await (const segment of session.generator) {
      if (session.cp.killed || session.cp.exitCode !== null) {
        break;
      }
      // No segment doesn't mean we're done necessarily, but it does mean we need to wait for FFmpeg to catch up.
      if (!segment) {
        continue;
      }

      // Keep track of how many segments we're sending to HKSV.
      this.transmittedSegments++;

      // Send HKSV the fMP4 segment.
      yield {data: segment.data, isLast: false};
    }

    // If FFmpeg timed out it's typically due to the quality of the video coming from the Protect controller. Restart the livestream API to see if we can improve things.
    if (session.cp.killed || session.cp.exitCode !== null) {

      // Send HKSV a final segment to cleanly wrap up.
      yield {data: Buffer.alloc(1, 0), isLast: true};
    }
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

  async* handleFragmentsRequests(configuration: CameraRecordingConfiguration): AsyncGenerator<Buffer, void, unknown> {
    this.log.debug('video fragments requested', this.cameraName);
    const session: FFMpegFragmentedMP4Session = await this.startSession(configuration);

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
          yield fragment;
        }
        this.log.debug(`mp4 box type ${type} and length: ${length}`, this.cameraName);
      }
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
    configuration: CameraRecordingConfiguration,
    iframeIntervalSeconds: number = 4,
  ): Promise<FFMpegFragmentedMP4Session> {

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
