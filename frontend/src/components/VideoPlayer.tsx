import { useContext, useEffect, useRef, useState } from 'react';
import { Airplay, Maximize, Minimize, Pause, PictureInPicture2, Play, Volume2, VolumeX } from 'lucide-react';
import Hls from 'hls.js';
import { Channel, ChannelMode } from '../types';
import apiService, { ApiError } from '../services/ApiService';
import socketService from '../services/SocketService';
import { ToastContext } from './notifications/ToastContext';

interface VideoPlayerProps {
  channel: Channel | null;
  syncEnabled: boolean;
}

interface AirPlaySession {
  playbackUrl: string;
}

type AirPlayVideoElement = HTMLVideoElement & {
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  webkitShowPlaybackTargetPicker?: () => void;
};

function envNumber(value: unknown, fallback: number) {
  if (
    value === undefined
    || value === null
    || (typeof value === 'string' && value.trim() === '')
  ) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function VideoPlayer({ channel, syncEnabled }: VideoPlayerProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const useCustomControls = navigator.maxTouchPoints === 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [airPlaySupported, setAirPlaySupported] = useState(false);
  const [airPlayActive, setAirPlayActive] = useState(false);
  const { addToast, removeToast, clearToasts, editToast } = useContext(ToastContext);

  useEffect(() => {
    if (!videoRef.current || !channel?.url) return;
    const video = videoRef.current as AirPlayVideoElement;
    let cancelled = false;
    setAirPlaySupported(false);

    const sourceLinks: Record<ChannelMode, string> = {
      direct: channel.url,
      //TODO: needs update for multi-channel streaming
      proxy: import.meta.env.VITE_BACKEND_URL + '/proxy/channel',
      restream: import.meta.env.VITE_BACKEND_URL + '/streams/' + channel.id + "/" + channel.id + ".m3u8",
    };

    const canPlayNativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
    const canUseAirPlay = typeof video.webkitShowPlaybackTargetPicker === 'function';

    const createAirPlaySession = async () => {
      const deadline = Date.now() + 90_000;
      while (true) {
        try {
          return await apiService.request<AirPlaySession>('/airplay/sessions', 'POST');
        } catch (error) {
          const retryableStatus = error instanceof ApiError && [502, 503, 504].includes(error.status);
          const retryableNetworkError = error instanceof TypeError;
          if ((!retryableStatus && !retryableNetworkError) || Date.now() >= deadline) {
            throw error;
          }
          await new Promise(resolve => window.setTimeout(resolve, 1_000));
          if (cancelled) return null;
        }
      }
    };

    const removeAirPlayAlternative = () => {
      video.querySelector('source[data-airplay-source]')?.remove();
    };

    const prepareAirPlayAlternative = async () => {
      if (!canUseAirPlay) return;
      try {
        const session = await createAirPlaySession();
        if (cancelled || !session) return;

        removeAirPlayAlternative();
        const source = document.createElement('source');
        source.dataset.airplaySource = 'true';
        source.type = 'application/vnd.apple.mpegurl';
        source.src = session.playbackUrl;
        video.appendChild(source);
        video.setAttribute('x-webkit-airplay', 'allow');
        // hls.js disables remote playback while it attaches ManagedMediaSource.
        // The alternate receiver-safe HLS source makes AirPlay available again.
        video.disableRemotePlayback = false;
        setAirPlaySupported(true);
      } catch (error) {
        if (!cancelled) console.error('Failed to prepare AirPlay playback:', error);
      }
    };

    if (Hls.isSupported()) {
      // Safari can play locally through hls.js (and therefore use the same
      // synchronization loop as other browsers) while AirPlay uses the
      // receiver-safe native HLS source prepared alongside it.
      void prepareAirPlayAlternative();

      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        autoStartLoad: syncEnabled ? false : true,
        liveDurationInfinity: true,
        // Prefer three target-duration segments behind the live edge. The
        // backend publishes restream switches after at least two exist.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        //debug: true,
        manifestLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: Infinity,
            maxLoadTimeMs: 20000,
            timeoutRetry: {
              maxNumRetry: 3,
              retryDelayMs: 0,
              maxRetryDelayMs: 0,
            },
            errorRetry: {
              maxNumRetry: 12,
              retryDelayMs: 1000,
              maxRetryDelayMs: 8000,
              backoff: 'linear',
              shouldRetry: (
                retryConfig,
                retryCount,
              ) => retryCount < retryConfig!.maxNumRetry
            },
          },
        },
      });

      hlsRef.current = hls;
      hls.loadSource(sourceLinks[channel.mode]);
      hls.attachMedia(video);

      const cleanup = () => {
        cancelled = true;
        setAirPlayActive(false);
        hls.destroy();
        removeAirPlayAlternative();
        video.removeAttribute('x-webkit-airplay');
        if (hlsRef.current === hls) hlsRef.current = null;
      };

      if(!syncEnabled) return cleanup;

      clearToasts();
      let toastStartId = null;
      toastStartId = addToast({
        type: 'loading',
        title: 'Starting Stream',
        message: 'This might take a few moments...',
        duration: 0,
      });

      const tolerance = envNumber(import.meta.env.VITE_SYNCHRONIZATION_TOLERANCE, 1.25);
      const maxDeviation = envNumber(import.meta.env.VITE_SYNCHRONIZATION_MAX_DEVIATION, 5);

      let toastDurationSet = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (channel.mode === 'restream') {
          const now = socketService.serverNow();
      
          const fragments = hls.levels[0]?.details?.fragments;
          const lastFragment = fragments?.[fragments.length - 1];
          if (!lastFragment || !lastFragment.programDateTime) {
            console.warn("No program date time found in fragment. Cannot synchronize.");
            return;
          }
      
          const timeDiff = (now - lastFragment.programDateTime) / 1000;
          const videoLength = fragments.reduce((acc, fragment) => acc + fragment.duration, 0);
          const targetDelay = envNumber(import.meta.env.VITE_STREAM_DELAY, 18);
      
          //Load stream if it is close to the target delay
          const timeTolerance = tolerance + 1;

          const delay = videoLength + timeDiff + timeTolerance;
          if (delay >= targetDelay) {
            hls.startLoad();
            video.play();
            console.log("Starting stream");
            if (!toastDurationSet && toastStartId) {
              removeToast(toastStartId);
            }
          } else {
            console.log("Waiting for stream to load: ", delay, " < ", targetDelay);

            if(!toastDurationSet && toastStartId) {
              editToast(toastStartId, {duration: (1 + targetDelay - delay) * 1000});
              toastDurationSet = true;
            }
      
            // Reload manifest
            setTimeout(() => {
              hls.loadSource(import.meta.env.VITE_BACKEND_URL + '/streams/' + channel.id + "/" + channel.id + ".m3u8");
            }, 1000); 
          }
        } else {
          hls.startLoad();
          video.play();

          if (toastStartId) {
            removeToast(toastStartId);
          }
        }
      });
      
      
      let timeMissingErrorShown = false;
      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        const newFrag = data.frag;

        if(!newFrag.programDateTime) {
          if(!timeMissingErrorShown) {
            addToast({
              type: 'error',
              title: 'Synchronization Error',
              message: `Playback can't be synchonized for this channel in ${channel.mode}. Change this channel to restream mode and try again.`,
              duration: 5000,
            });
            console.warn("No program date time found in fragment. Cannot synchronize.");
            timeMissingErrorShown = true;
          }
        }
      });

      const targetDelay = channel.mode == 'restream'
        ? envNumber(import.meta.env.VITE_STREAM_DELAY, 18)
        : envNumber(import.meta.env.VITE_STREAM_PROXY_DELAY, 30);
      const adjustmentFactor = envNumber(import.meta.env.VITE_SYNCHRONIZATION_ADJUSTMENT, 0.02);
      const maxAdjustment = envNumber(import.meta.env.VITE_SYNCHRONIZATION_MAX_ADJUSTMENT, 0.04);
      const hardCorrectionCooldownMs = 15_000;
      let smoothedDeviation: number | null = null;
      let lastHardCorrectionAt = 0;

      const correctPlayback = () => {
        const playingDate = hls.playingDate;
        if (!playingDate || video.paused || video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          return;
        }

        const delay = (socketService.serverNow() - playingDate.getTime()) / 1000;
        const rawDeviation = delay - targetDelay;
        const now = performance.now();
        const targetDuration = hls.latestLevelDetails?.targetduration || 6;
        const minimumLiveLatency = targetDuration * 2;

        // Never consume the live buffer just to reach a wall-clock target that
        // is closer to the edge than the stream can sustain. This is especially
        // important just after a channel switch, while the new playlist is
        // still building its first few segments.
        if (rawDeviation > tolerance && hls.latency <= minimumLiveLatency) {
          video.playbackRate = 1;
          smoothedDeviation = null;
          return;
        }

        if (
          Math.abs(rawDeviation) > maxDeviation
          && now - lastHardCorrectionAt >= hardCorrectionCooldownMs
        ) {
          const seekableIndex = video.seekable.length - 1;
          const safeLiveEdge = seekableIndex >= 0
            ? video.seekable.end(seekableIndex) - minimumLiveLatency
            : Number.NEGATIVE_INFINITY;
          const targetTime = rawDeviation > 0
            ? Math.min(video.currentTime + rawDeviation, safeLiveEdge)
            : video.currentTime + rawDeviation;
          if (
            seekableIndex >= 0
            && targetTime >= video.seekable.start(seekableIndex)
            && targetTime <= safeLiveEdge
          ) {
            video.currentTime = targetTime;
            video.playbackRate = 1;
            smoothedDeviation = null;
            lastHardCorrectionAt = now;
            console.log('Significant synchronization deviation detected. Adjusting current time.');
            return;
          }
        }

        smoothedDeviation = smoothedDeviation === null
          ? rawDeviation
          : smoothedDeviation * 0.75 + rawDeviation * 0.25;

        if (Math.abs(smoothedDeviation) <= tolerance) {
          video.playbackRate = 1;
          return;
        }

        const rateAdjustment = Math.min(
          Math.abs(adjustmentFactor * smoothedDeviation),
          maxAdjustment,
        );
        video.playbackRate = 1 + Math.sign(smoothedDeviation) * rateAdjustment;
      };

      const correctionTimer = window.setInterval(correctPlayback, 1_000);

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {

          console.error('HLS error:', data);

          if (toastStartId) {
            removeToast(toastStartId);
          }

          const messages: Record<ChannelMode, string> = {
            direct: 'The stream is not working. Try with proxy/restream option enabled for this channel.',
            proxy: 'The stream is not working. Try with restream option enabled for this channel.',
            restream: `The stream is not working. Check the source. ${data.response?.text}`,
          };
          
          addToast({
            type: 'error',
            title: 'Stream Error',
            message: messages[channel.mode],
            duration: 5000,
          });
          return;
          
        }
      });
      return () => {
        window.clearInterval(correctionTimer);
        video.playbackRate = 1;
        cleanup();
      };
    }

    if (canPlayNativeHls) {
      video.setAttribute('x-webkit-airplay', 'allow');
      video.disableRemotePlayback = false;

      const startNativePlayback = async () => {
        clearToasts();
        const toastId = addToast({
          type: 'loading',
          title: 'Starting Stream',
          message: 'Waiting for the live stream to become ready...',
          duration: 0,
        });

        try {
          const session = await createAirPlaySession();
          if (cancelled || !session) return;

          video.src = session.playbackUrl;
          video.load();
          await video.play();
          setAirPlaySupported(canUseAirPlay);
        } catch (error) {
          if (cancelled) return;
          console.error('Failed to start native HLS playback:', error);
          addToast({
            type: 'error',
            title: 'Stream unavailable',
            message: error instanceof ApiError ? error.message : 'This stream could not be started.',
            duration: 5000,
          });
        } finally {
          removeToast(toastId);
        }
      };

      void startNativePlayback();

      return () => {
        cancelled = true;
        setAirPlayActive(false);
        video.pause();
        video.removeAttribute('src');
        video.removeAttribute('x-webkit-airplay');
        video.load();
      };
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };

  }, [channel?.id, channel?.url, channel?.mode, syncEnabled, addToast, clearToasts, editToast, removeToast]);

  useEffect(() => {
    const video = videoRef.current as AirPlayVideoElement | null;
    if (!video) return;

    const updatePlaying = () => setIsPlaying(!video.paused && !video.ended);
    const updateMuted = () => setIsMuted(video.muted);
    const updateAirPlay = () => setAirPlayActive(Boolean(video.webkitCurrentPlaybackTargetIsWireless));

    video.addEventListener('play', updatePlaying);
    video.addEventListener('pause', updatePlaying);
    video.addEventListener('ended', updatePlaying);
    video.addEventListener('volumechange', updateMuted);
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', updateAirPlay);
    updatePlaying();
    updateMuted();
    updateAirPlay();

    return () => {
      video.removeEventListener('play', updatePlaying);
      video.removeEventListener('pause', updatePlaying);
      video.removeEventListener('ended', updatePlaying);
      video.removeEventListener('volumechange', updateMuted);
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', updateAirPlay);
    };
  }, []);

  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === frameRef.current);
    };

    document.addEventListener('fullscreenchange', updateFullscreen);
    updateFullscreen();

    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const controls = controlsRef.current;
    let hideTimer: number | undefined;

    const clearHideTimer = () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      hideTimer = undefined;
    };

    if (!isFullscreen || !frame || !controls) {
      setControlsVisible(true);
      return clearHideTimer;
    }

    const keepControlsVisible = () => {
      clearHideTimer();
      setControlsVisible(true);
    };

    const scheduleControlsFade = () => {
      keepControlsVisible();
      hideTimer = window.setTimeout(() => {
        const controlsAreActive = controls.matches(':hover') || controls.querySelector(':focus-visible') !== null;
        if (!controlsAreActive) setControlsVisible(false);
      }, 3_000);
    };

    frame.addEventListener('pointermove', scheduleControlsFade);
    controls.addEventListener('pointerenter', keepControlsVisible);
    controls.addEventListener('pointerleave', scheduleControlsFade);
    controls.addEventListener('focusin', keepControlsVisible);
    controls.addEventListener('focusout', scheduleControlsFade);
    scheduleControlsFade();

    return () => {
      clearHideTimer();
      frame.removeEventListener('pointermove', scheduleControlsFade);
      controls.removeEventListener('pointerenter', keepControlsVisible);
      controls.removeEventListener('pointerleave', scheduleControlsFade);
      controls.removeEventListener('focusin', keepControlsVisible);
      controls.removeEventListener('focusout', scheduleControlsFade);
    };
  }, [isFullscreen]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (video) video.muted = !video.muted;
  };

  const showAirPlayPicker = () => {
    const video = videoRef.current as AirPlayVideoElement | null;
    video?.webkitShowPlaybackTargetPicker?.();
  };

  const enterPictureInPicture = () => {
    const video = videoRef.current;
    if (video && document.pictureInPictureEnabled && !video.disablePictureInPicture) {
      video.requestPictureInPicture().catch(() => undefined);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      frameRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  return (
    <div ref={frameRef} className="video-frame relative">
      <video
        ref={videoRef}
        className="block h-auto max-h-[calc(100vh-7rem)] w-full bg-black object-contain aspect-video"
        muted
        autoPlay
        playsInline
        controls={!useCustomControls}
        onClick={useCustomControls ? togglePlayback : undefined}
      />
      {useCustomControls && (
        <div
          ref={controlsRef}
          className={`player-controls absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-10 text-white transition-opacity duration-300 ${isFullscreen && !controlsVisible ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        >
          <button type="button" onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause' : 'Play'} className="rounded-md p-2 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF]">
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button type="button" onClick={toggleMuted} aria-label={isMuted ? 'Unmute' : 'Mute'} title={isMuted ? 'Unmute' : 'Mute'} className="rounded-md p-2 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF]">
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <span className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/80">Live</span>
          <div className="flex-1" />
          {airPlaySupported && (
            <button type="button" onClick={showAirPlayPicker} aria-label="AirPlay" aria-pressed={airPlayActive} title="AirPlay" className={`rounded-md p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF] ${airPlayActive ? 'bg-[#4EA1FF] text-[#07111B]' : 'hover:bg-white/15'}`}>
              <Airplay className="h-5 w-5" />
            </button>
          )}
          <button type="button" onClick={enterPictureInPicture} aria-label="Picture in Picture" title="Picture in Picture" className="rounded-md p-2 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF]">
            <PictureInPicture2 className="h-5 w-5" />
          </button>
          <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'} title={isFullscreen ? 'Exit full screen' : 'Full screen'} className="rounded-md p-2 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF]">
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
