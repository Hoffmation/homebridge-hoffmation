import { Hoffmation } from '../platform';
import {
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraStreamingDelegate,
  Logging,
  PlatformAccessory,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  VideoInfo,
} from 'homebridge';
import { HoffmationApiDevice } from '../models/hoffmationApi/hoffmationApiDevice';
import pickPort, { pickPortOptions } from 'pick-port';
import got, { Headers, Options as RequestOptions } from 'got';
import { hap } from '../hap';
import { createSocket, Socket } from 'dgram';
import { APIEvent } from 'homebridge/lib/api';
import { FfmpegProcess } from './ffmpeg-process';
import { FfmpegLogger } from './ffmpeg-logger';
import { ExtendedResponse } from './ExtendedResponse';
import { VideoConfig } from './VideoConfig';
import { HoffmationConfig } from '../models/config';

function getDurationSeconds(start: number) {
  return (Date.now() - start) / 1000;
}

const snapShotLifeTime = 5 * 1000;

export class CameraDelegate implements CameraStreamingDelegate {
  public readonly controller;
  private readonly log: Logging;
  private readonly ffmpegLog: FfmpegLogger;
  private lastSnapshotTimestamp = 0;
  private lastSnapshotTimestampLocal = 0;
  private pendingSessions: Map<string, SessionInfo> = new Map();
  private ongoingSessions: Map<string, ActiveSession> = new Map();
  private readonly videoConfig: VideoConfig;
  private readonly videoUrl: string;
  private readonly videoProcessor: string;
  private fn = 1;

  get hasSnapshotWithinLifetime() {
    return this.lastSnapshotTimestamp + snapShotLifeTime > new Date().getTime();
  }

  constructor(
    private readonly platform: Hoffmation,
    private readonly accessory: PlatformAccessory,
    private readonly device: HoffmationApiDevice,
  ) {
    const useRtsp = (platform.config as HoffmationConfig).useRtspStream ?? false;
    if (useRtsp) {
      this.videoUrl = `-i ${device.rtspUrl}`;
    } else {
      this.videoUrl = `-i ${device.h264IosStreamLink.replace('/temp.m', '/temp.ts')}`;
    }
    this.log = platform.log;
    this.ffmpegLog = new FfmpegLogger(this.log);
    this.log.debug(`Creating new CameraDelegate for ${this.device.name} with videoUrl ${this.videoUrl}`);
    this.videoConfig = {
      source: this.videoUrl,
      vcodec: 'copy',
      // maxStreams: 4,
      // maxWidth: 1920,
      // maxHeight: 1080,
      // maxFPS: 5,
    };
    this.videoProcessor = 'ffmpeg';
    platform.api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
    });
    this.controller = new hap.CameraController({
      cameraStreamCount: 4,
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [1280, 720, 30],
            [1280, 720, 5],
            [1024, 768, 30],
            [1024, 768, 5],
            [640, 480, 30],
            [640, 480, 5],
            [640, 360, 30],
            [480, 360, 30],
            [480, 360, 5],
            [480, 270, 30],
            [320, 240, 30],
            [320, 240, 5],
            [320, 240, 15], // Apple Watch requires this configuration
            [320, 180, 30],
            [320, 180, 5],
          ],
          codec: {
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: !!this.videoConfig.returnAudioTarget,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
              /*type: AudioStreamingCodecType.OPUS,
              samplerate: AudioStreamingSamplerate.KHZ_24*/
            },
          ],
        },
      },
    });
  }

  private cachedSnapshot?: Buffer;

  private previousLoadSnapshotPromise?: Promise<Buffer | undefined>;

  async loadSnapshot() {
    // this.log.debug(`Loading snapshot for ${this.device.name}`);
    // cache a promise of the snapshot load
    // This prevents multiple concurrent requests for snapshot from pilling up and creating lots of logs
    if (this.previousLoadSnapshotPromise) {
      return this.previousLoadSnapshotPromise;
    }

    this.previousLoadSnapshotPromise = this.loadAndCacheSnapshot();

    let result: Buffer | undefined;
    try {
      result = await this.previousLoadSnapshotPromise;
    } catch (_) {
      // ignore errors
    } finally {
      // clear so another request can be made
      this.previousLoadSnapshotPromise = undefined;
    }
    return result;
  }


  private async loadAndCacheSnapshot() {
    const start = Date.now();
    // this.log.debug( `Loading new snapshot into cache for ${this.device.name}`);

    try {
      const previousSnapshot = this.cachedSnapshot;
      const newSnapshot = await this.getSnapshot();
      this.cachedSnapshot = newSnapshot;

      if (previousSnapshot !== newSnapshot) {
        // Keep the snapshots in cache 2 minutes longer than their lifetime
        // This allows users on LTE with wired camera to get snapshots each 60 second pull even though the cached snapshot is out of date
        setTimeout(() => {
          if (this.cachedSnapshot === newSnapshot) {
            this.cachedSnapshot = undefined;
          }
        }, snapShotLifeTime + 2 * 60 * 1000);
      }

      // this.log.debug(`Snapshot cached for ${this.device.name} (${getDurationSeconds(start)}s)`);
      return newSnapshot;
    } catch (e: unknown) {
      this.cachedSnapshot = undefined;
      this.log.debug(`Failed to cache snapshot for ${this.device.name} (${getDurationSeconds(start)}s)`);

      // log additioanl snapshot error message if one is present
      if ((e as Error)?.message?.includes('Snapshot')) {
        this.log.debug((e as Error).message);
      }
    }
  }

  private async getCurrentSnapshot() {
    // this.log.debug(`${this.cachedSnapshot ? 'Used cached snapshot' : 'No snapshot cached'} for ${this.device.name}`);

    if (!this.hasSnapshotWithinLifetime) {
      return await this.loadSnapshot().catch(this.log.error);
    }

    // may or may not have a snapshot cached
    return this.cachedSnapshot;
  }

  async handleSnapshotRequest(
    request: SnapshotRequest,
    callback: SnapshotRequestCallback,
  ) {
    try {
      // this.log.debug(`Snapshot requested for ${this.device.name}`);
      const snapshot = await this.getCurrentSnapshot();

      if (!snapshot) {
        // return an error to prevent "empty image buffer" warnings
        return callback(new Error('No Snapshot Cached'));
      }

      // this.log.debug(`Snapshot received for ${this.device.name}`);
      // Not currently resizing the image.
      // HomeKit does a good job of resizing and doesn't seem to care if it's not right
      callback(undefined, snapshot);
    } catch (e: unknown) {
      this.log.error(`Error fetching snapshot for ${this.device.name}`);
      this.log.error(e as string);
      callback(e as Error);
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    this.log.debug(`prepareStream requested for ${this.device.name}`);
    const ipv6 = request.addressVersion === 'ipv6';

    const options: pickPortOptions = {
      type: 'udp',
      ip: ipv6 ? '::' : '0.0.0.0',
      reserveTimeout: 15,
    };
    const videoReturnPort = await pickPort(options);
    const videoSSRC = hap.CameraController.generateSynchronisationSource();
    const audioReturnPort = await pickPort(options);
    const audioSSRC = hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      ipv6: ipv6,

      videoPort: request.video.port,
      videoReturnPort: videoReturnPort,
      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC: videoSSRC,

      audioPort: request.audio.port,
      audioReturnPort: audioReturnPort,
      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC: audioSSRC,
    };

    const response: PrepareStreamResponse = {
      video: {
        port: videoReturnPort,
        ssrc: videoSSRC,

        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
      audio: {
        port: audioReturnPort,
        ssrc: audioSSRC,

        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      },
    };

    this.pendingSessions.set(request.sessionID, sessionInfo);
    callback(undefined, response);
  }

  private startStream(request: StartStreamRequest, callback: StreamRequestCallback): void {
    const sessionInfo = this.pendingSessions.get(request.sessionID);
    if (!sessionInfo) {
      this.log.error('Error finding session information.', this.device.name);
      callback(new Error('Error finding session information'));
      return;
    }

    const vcodec = this.videoConfig.vcodec || 'libx264';
    const mtu = this.videoConfig.packetSize || 1316; // request.video.mtu is not used
    let encoderOptions = this.videoConfig.encoderOptions;
    if (!encoderOptions && vcodec === 'libx264') {
      encoderOptions = '-preset ultrafast -tune zerolatency';
    }

    const resolution = this.determineResolution(request.video);

    let fps = (this.videoConfig.maxFPS !== undefined &&
      (this.videoConfig.forceMax || request.video.fps > this.videoConfig.maxFPS)) ?
      this.videoConfig.maxFPS : request.video.fps;
    let videoBitrate = (this.videoConfig.maxBitrate !== undefined &&
      (this.videoConfig.forceMax || request.video.max_bit_rate > this.videoConfig.maxBitrate)) ?
      this.videoConfig.maxBitrate : request.video.max_bit_rate;

    if (vcodec === 'copy') {
      resolution.width = 0;
      resolution.height = 0;
      resolution.videoFilter = undefined;
      fps = 0;
      videoBitrate = 0;
    }

    // this.log.debug('Video stream requested: ' + request.video.width + ' x ' + request.video.height + ', ' +
    //   request.video.fps + ' fps, ' + request.video.max_bit_rate + ' kbps', this.device.name, this.videoConfig.debug);
    this.log.debug(`Starting video stream: ${resolution.width > 0 ? resolution.width : 'native'} x ${
      resolution.height > 0 ? resolution.height : 'native'
    }, ${fps > 0 ? fps : 'native'} fps, ${
      videoBitrate > 0 ? videoBitrate : '???'} kbps${
      this.videoConfig.audio ? (' (' + request.audio.codec + ')') : ''}`, this.device.name);

    let ffmpegArgs = this.videoConfig.source!;

    ffmpegArgs += // Video
      (this.videoConfig.mapvideo ? ' -map ' + this.videoConfig.mapvideo : ' -an -sn -dn') +
      ' -codec:v ' + vcodec +
      ' -pix_fmt yuv420p' +
      ' -color_range mpeg' +
      (fps > 0 ? ' -r ' + fps : '') +
      ' -f rawvideo' +
      // ' -f rtsp' +
      (encoderOptions ? ' ' + encoderOptions : '') +
      (resolution.videoFilter ? ' -filter:v ' + resolution.videoFilter : '') +
      (videoBitrate > 0 ? ' -b:v ' + videoBitrate + 'k' : '') +
      ' -payload_type ' + request.video.pt;

    ffmpegArgs += // Video Stream
      ' -ssrc ' + sessionInfo.videoSSRC +
      ' -f rtp' +
      ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
      ' -srtp_out_params ' + sessionInfo.videoSRTP.toString('base64') +
      ' srtp://' + sessionInfo.address + ':' + sessionInfo.videoPort +
      '?rtcpport=' + sessionInfo.videoPort + '&pkt_size=' + mtu;

    if (this.videoConfig.audio) {
      if (request.audio.codec === AudioStreamingCodecType.OPUS || request.audio.codec === AudioStreamingCodecType.AAC_ELD) {
        ffmpegArgs += // Audio
          (this.videoConfig.mapaudio ? ' -map ' + this.videoConfig.mapaudio : ' -vn -sn -dn') +
          (request.audio.codec === AudioStreamingCodecType.OPUS ?
            ' -codec:a libopus' +
            ' -application lowdelay' :
            ' -codec:a libfdk_aac' +
            ' -profile:a aac_eld') +
          ' -flags +global_header' +
          ' -f null' +
          ' -ar ' + request.audio.sample_rate + 'k' +
          ' -b:a ' + request.audio.max_bit_rate + 'k' +
          ' -ac ' + request.audio.channel +
          ' -payload_type ' + request.audio.pt;

        ffmpegArgs += // Audio Stream
          ' -ssrc ' + sessionInfo.audioSSRC +
          ' -f rtp' +
          ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
          ' -srtp_out_params ' + sessionInfo.audioSRTP.toString('base64') +
          ' srtp://' + sessionInfo.address + ':' + sessionInfo.audioPort +
          '?rtcpport=' + sessionInfo.audioPort + '&pkt_size=188';
      } else {
        this.log.error('Unsupported audio codec requested: ' + request.audio.codec, this.device.name);
      }
    }

    ffmpegArgs += ' -loglevel level' + (this.videoConfig.debug ? '+verbose' : '') +
      ' -progress pipe:1';

    const activeSession: ActiveSession = {};

    activeSession.socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
    activeSession.socket.on('error', (err: Error) => {
      this.log.error('Socket error: ' + err.message, this.device.name);
      this.stopStream(request.sessionID);
    });
    activeSession.socket.on('message', () => {
      if (activeSession.timeout) {
        clearTimeout(activeSession.timeout);
      }
      activeSession.timeout = setTimeout(() => {
        this.log.info('Device appears to be inactive. Stopping stream.', this.device.name);
        this.controller.forceStopStreamingSession(request.sessionID);
        this.stopStream(request.sessionID);
      }, request.video.rtcp_interval * 5 * 1000);
    });
    activeSession.socket.bind(sessionInfo.videoReturnPort);

    activeSession.mainProcess = new FfmpegProcess(this.device.name, request.sessionID, this.videoProcessor,
      ffmpegArgs, this.ffmpegLog, this.videoConfig.debug, this, callback);

    if (this.videoConfig.returnAudioTarget) {
      const ffmpegReturnArgs =
        '-hide_banner' +
        ' -protocol_whitelist pipe,udp,rtp,file,crypto' +
        ' -f sdp' +
        ' -c:a libfdk_aac' +
        ' -i pipe:' +
        ' ' + this.videoConfig.returnAudioTarget +
        ' -loglevel level' + (this.videoConfig.debugReturn ? '+verbose' : '');

      const ipVer = sessionInfo.ipv6 ? 'IP6' : 'IP4';

      const sdpReturnAudio =
        'v=0\r\n' +
        'o=- 0 0 IN ' + ipVer + ' ' + sessionInfo.address + '\r\n' +
        's=Talk\r\n' +
        'c=IN ' + ipVer + ' ' + sessionInfo.address + '\r\n' +
        't=0 0\r\n' +
        'm=audio ' + sessionInfo.audioReturnPort + ' RTP/AVP 110\r\n' +
        'b=AS:24\r\n' +
        'a=rtpmap:110 MPEG4-GENERIC/16000/1\r\n' +
        'a=rtcp-mux\r\n' + // FFmpeg ignores this, but might as well
        'a=fmtp:110 ' +
        'profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; ' +
        'config=F8F0212C00BC00\r\n' +
        'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:' + sessionInfo.audioSRTP.toString('base64') + '\r\n';
      activeSession.returnProcess = new FfmpegProcess(this.device.name + '] [Two-way', request.sessionID,
        this.videoProcessor, ffmpegReturnArgs, this.ffmpegLog, this.videoConfig.debugReturn, this);
      activeSession.returnProcess.stdin.end(sdpReturnAudio);
    }

    this.ongoingSessions.set(request.sessionID, activeSession);
    this.pendingSessions.delete(request.sessionID);
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    // this.log.debug('handleStreamRequest', this.device.name);
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug('Received request to reconfigure: ' + request.video.width + ' x ' + request.video.height + ', ' +
          request.video.fps + ' fps, ' + request.video.max_bit_rate + ' kbps (Ignored)', this.device.name, this.videoConfig.debug);
        callback();
        break;
      case StreamRequestTypes.STOP:
        this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  public stopStream(sessionId: string): void {
    this.log.debug('Stopping video stream.', this.device.name);
    const session = this.ongoingSessions.get(sessionId);
    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout);
      }
      try {
        session.socket?.close();
      } catch (err) {
        this.log.error('Error occurred closing socket: ' + err, this.device.name);
      }
      try {
        session.mainProcess?.stop();
      } catch (err) {
        this.log.error('Error occurred terminating main FFmpeg process: ' + err, this.device.name);
      }
      try {
        session.returnProcess?.stop();
      } catch (err) {
        this.log.error('Error occurred terminating two-way FFmpeg process: ' + err, this.device.name);
      }
    }
    this.ongoingSessions.delete(sessionId);
    this.log.debug('Stopped video stream.', this.device.name);
  }

  private async getSnapshot(): Promise<Buffer> {
    const response = await this.request<Buffer>({
      url: this.device.snapshotUrl + `&fn=${this.fn++}`,
      responseType: 'buffer',
      headers: {
        accept: 'image/jpeg',
      },
    });
    const {responseTimestamp, timeMillis} = response;
    const timestampAge = Math.abs(responseTimestamp - timeMillis);

    this.lastSnapshotTimestamp = timeMillis;
    this.lastSnapshotTimestampLocal = Date.now() - timestampAge;
    return response;
  }

  private async request<T>(requestOptions: RequestOptions): Promise<T & ExtendedResponse> {
    const defaultRequestOptions: RequestOptions = {
      responseType: 'json',
      method: 'GET',
      retry: 0,
      timeout: 20000,
    };
    const options = {
      ...defaultRequestOptions,
      ...requestOptions,
    };
    const {headers, body} = (await got(options)) as {
      headers: Headers;
      body: unknown;
    };
    const data = body as T & ExtendedResponse;
    if (data !== null && typeof data === 'object') {
      if (headers.date) {
        data.responseTimestamp = new Date(headers.date as string).getTime();
      }

      if (headers['x-time-millis']) {
        data.timeMillis = Number(headers['x-time-millis']);
      }
    }
    return data;
  }

  private determineResolution(request: VideoInfo): ResolutionInfo {
    const resInfo: ResolutionInfo = {
      width: request.width,
      height: request.height,
    };

    if (this.videoConfig.maxWidth !== undefined &&
      (this.videoConfig.forceMax || request.width > this.videoConfig.maxWidth)) {
      resInfo.width = this.videoConfig.maxWidth;
    }
    if (this.videoConfig.maxHeight !== undefined &&
      (this.videoConfig.forceMax || request.height > this.videoConfig.maxHeight)) {
      resInfo.height = this.videoConfig.maxHeight;
    }

    const filters: Array<string> = this.videoConfig.videoFilter?.split(',') || [];
    const noneFilter = filters.indexOf('none');
    if (noneFilter >= 0) {
      filters.splice(noneFilter, 1);
    }
    resInfo.snapFilter = filters.join(',');
    if ((noneFilter < 0) && (resInfo.width > 0 || resInfo.height > 0)) {
      resInfo.resizeFilter = 'scale=' + (resInfo.width > 0 ? '\'min(' + resInfo.width + ',iw)\'' : 'iw') + ':' +
        (resInfo.height > 0 ? '\'min(' + resInfo.height + ',ih)\'' : 'ih') +
        ':force_original_aspect_ratio=decrease';
      filters.push(resInfo.resizeFilter);
      filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2'); // Force to fit encoder restrictions
    }

    if (filters.length > 0) {
      resInfo.videoFilter = filters.join(',');
    }

    return resInfo;
  }
}

type SessionInfo = {
  address: string; // address of the HAP controller
  ipv6: boolean;

  videoPort: number;
  videoReturnPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
  videoSRTP: Buffer; // key and salt concatenated
  videoSSRC: number; // rtp synchronisation source

  audioPort: number;
  audioReturnPort: number;
  audioCryptoSuite: SRTPCryptoSuites;
  audioSRTP: Buffer;
  audioSSRC: number;
};

type ResolutionInfo = {
  width: number;
  height: number;
  videoFilter?: string;
  snapFilter?: string;
  resizeFilter?: string;
};

type ActiveSession = {
  mainProcess?: FfmpegProcess;
  returnProcess?: FfmpegProcess;
  timeout?: NodeJS.Timeout;
  socket?: Socket;
};

