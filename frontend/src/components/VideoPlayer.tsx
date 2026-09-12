import { useContext, useEffect, useRef, useState } from 'react';
import { Airplay, Maximize, Pause, PictureInPicture2, Play, Volume2, VolumeX } from 'lucide-react';
import Hls from 'hls.js';
import { Channel, ChannelMode } from '../types';
import apiService, { ApiError } from '../services/ApiService';
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

function VideoPlayer({ channel, syncEnabled }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const useCustomControls = navigator.maxTouchPoints === 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [airPlaySupported, setAirPlaySupported] = useState(false);
  const [airPlayActive, setAirPlayActive] = useState(false);
  const { addToast, removeToast, clearToasts, editToast } = useContext(ToastContext);

  useEffect(() => {
    if (!videoRef.current || !channel?.url) return;
    const video = videoRef.current as AirPlayVideoElement;
    let cancelled = false;

    const sourceLinks: Record<ChannelMode, string> = {
      direct: channel.url,
      //TODO: needs update for multi-channel streaming
      proxy: import.meta.env.VITE_BACKEND_URL + '/proxy/channel',
      restream: import.meta.env.VITE_BACKEND_URL + '/streams/' + channel.id + "/" + channel.id + ".m3u8",
    };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      setAirPlaySupported(typeof video.webkitShowPlaybackTargetPicker === 'function');
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
          const deadline = Date.now() + 90_000;
          let session: AirPlaySession;
          while (true) {
            try {
              session = await apiService.request<AirPlaySession>('/airplay/sessions', 'POST');
              break;
            } catch (error) {
              const retryableStatus = error instanceof ApiError && [502, 503, 504].includes(error.status);
              const retryableNetworkError = error instanceof TypeError;
              if ((!retryableStatus && !retryableNetworkError) || Date.now() >= deadline) {
                throw error;
              }
              await new Promise(resolve => window.setTimeout(resolve, 1_000));
              if (cancelled) return;
            }
          }
          if (cancelled) return;

          video.src = session.playbackUrl;
          video.load();
          await video.play();
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

    if (Hls.isSupported()) {
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
        hls.destroy();
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

      const tolerance = import.meta.env.VITE_SYNCHRONIZATION_TOLERANCE || 0.8;
      const maxDeviation = import.meta.env.VITE_SYNCHRONIZATION_MAX_DEVIATION || 4;

      let toastDurationSet = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (channel.mode === 'restream') {
          const now = new Date().getTime();
      
          const fragments = hls.levels[0]?.details?.fragments;
          const lastFragment = fragments?.[fragments.length - 1];
          if (!lastFragment || !lastFragment.programDateTime) {
            console.warn("No program date time found in fragment. Cannot synchronize.");
            return;
          }
      
          const timeDiff = (now - lastFragment.programDateTime) / 1000;
          const videoLength = fragments.reduce((acc, fragment) => acc + fragment.duration, 0);
          const targetDelay : number = Number(import.meta.env.VITE_STREAM_DELAY);
      
          //Load stream if it is close to the target delay
          const timeTolerance = tolerance + 1;

          const delay : number = videoLength + timeDiff + timeTolerance;
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

        const now = new Date().getTime();
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
          return;
        }
        const timeDiff = (now - newFrag.programDateTime) / 1000;
        const videoDiff = newFrag.end - video.currentTime;
        //console.log("Time Diff: ", timeDiff, "Video Diff: ", videoDiff);
        const delay = timeDiff + videoDiff;
        
        const targetDelay = channel.mode == 'restream' ? import.meta.env.VITE_STREAM_DELAY : import.meta.env.VITE_STREAM_PROXY_DELAY;
       // console.log("Delay: ", delay, "Target Delay: ", targetDelay);

        const deviation = delay - targetDelay;

        if (Math.abs(deviation) > maxDeviation) {
          video.currentTime += deviation;
          video.playbackRate = 1.0;
          console.log("Significant deviation detected. Adjusting current time.");

          // TODO
          // console.log("New Time: ", video.currentTime, "New Frag: ", newFrag.end);
          // if(video.paused) {
          //   console.warn("[Synchronization Issue] Video stopped. Switch to Restream Mode for this channel");
          //   deviationErrorCount++;
          //   if(deviationErrorCount > 2) {
          //     addToast({
          //       type: 'error',
          //       title: 'Synchronization Error',
          //       message: `Having problems synchronizing playback for the channel in mode: ${channel.mode}. Try to change to restream mode or turn off synchronization.`,
          //       duration: 5000,
          //     });
          //   }
          // }
        } else if (Math.abs(deviation) > tolerance) {
          const adjustmentFactor = import.meta.env.VITE_SYNCHRONIZATION_ADJUSTMENT || 0.06;
          const speedAdjustment = 1 +  Math.sign(deviation) * Math.min(Math.abs(adjustmentFactor * deviation), import.meta.env.VITE_SYNCHRONIZATION_MAX_ADJUSTMENT || 0.16);
          video.playbackRate = speedAdjustment;
        } else {
          video.playbackRate = 1.0;
        }
      });

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
      return cleanup;
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

  const enterFullscreen = () => {
    videoRef.current?.parentElement?.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="video-frame relative">
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
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-10 text-white">
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
          <button type="button" onClick={enterFullscreen} aria-label="Full screen" title="Full screen" className="rounded-md p-2 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF]">
            <Maximize className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
