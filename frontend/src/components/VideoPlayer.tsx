import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Airplay, Maximize, Minimize, Pause, PictureInPicture2, Play, SmilePlus, Volume2, VolumeX } from 'lucide-react';
import Hls from 'hls.js';
import { Channel, ChannelMode, VideoReaction } from '../types';
import apiService, { ApiError } from '../services/ApiService';
import socketService from '../services/SocketService';
import { readStoredUsername, storeUsername, USERNAME_CHANGED_EVENT } from '../services/UsernameStorage';
import { ToastContext } from './notifications/ToastContext';
import UsernameModal from './chat/UsernameModal';

interface VideoPlayerProps {
  channel: Channel | null;
  syncEnabled: boolean;
}

interface AirPlaySession {
  playbackUrl: string;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  userName: string;
  left: number;
  drift: number;
  rotation: number;
  duration: number;
}

const REACTIONS = [
  { emoji: '🏈', label: 'Touchdown' },
  { emoji: '🙌', label: 'Celebrate' },
  { emoji: '😬', label: 'Wince' },
  { emoji: '👏', label: 'Great play' },
  { emoji: '🚩', label: 'Penalty flag' },
  { emoji: '👎', label: 'Boo' },
] as const;

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
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [username, setUsername] = useState(readStoredUsername);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const reactionIdRef = useRef(0);
  const reactionTimersRef = useRef<number[]>([]);
  const pendingReactionRef = useRef<string | null>(null);
  const { addToast, removeToast, clearToasts } = useContext(ToastContext);

  const displayReaction = useCallback((emoji: string, userName: string) => {
    const id = reactionIdRef.current += 1;
    const duration = 2100 + Math.random() * 650;
    const reaction: FloatingReaction = {
      id,
      emoji,
      userName,
      left: 66 + Math.random() * 22,
      drift: -48 + Math.random() * 96,
      rotation: -12 + Math.random() * 24,
      duration,
    };

    setFloatingReactions((current) => [...current.slice(-11), reaction]);
    const timer = window.setTimeout(() => {
      setFloatingReactions((current) => current.filter((item) => item.id !== id));
      reactionTimersRef.current = reactionTimersRef.current.filter((item) => item !== timer);
    }, duration + 250);
    reactionTimersRef.current.push(timer);
  }, []);

  useEffect(() => () => {
    reactionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const reactionListener = (reaction: VideoReaction) => {
      displayReaction(reaction.emoji, reaction.user.name);
    };
    const usernameChangedListener = (event: Event) => {
      setUsername((event as CustomEvent<string>).detail);
    };

    socketService.subscribeToEvent('video-reaction', reactionListener);
    window.addEventListener(USERNAME_CHANGED_EVENT, usernameChangedListener);
    return () => {
      socketService.unsubscribeFromEvent('video-reaction', reactionListener);
      window.removeEventListener(USERNAME_CHANGED_EVENT, usernameChangedListener);
    };
  }, [displayReaction]);

  useEffect(() => {
    if (!reactionsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReactionsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [reactionsOpen]);

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
    const canUseManagedMediaSource = 'ManagedMediaSource' in window;
    // iPhone/iPad Safari is most reliable when the receiver-safe HLS URL is
    // the video's primary source. Its ManagedMediaSource-to-AirPlay fallback
    // varies by iOS/WebKit version and can degrade into audio-only routing.
    const preferNativeAirPlay = !useCustomControls && canUseAirPlay && canPlayNativeHls;

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
        // WebKit recognizes this as the remote-playback alternative to the
        // local ManagedMediaSource attached by hls.js.
        source.type = 'application/x-mpegURL';
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

    if (Hls.isSupported() && !preferNativeAirPlay && (!canUseAirPlay || canUseManagedMediaSource)) {
      // Safari can play locally through hls.js (and therefore use the same
      // synchronization loop as other browsers) while AirPlay uses the
      // receiver-safe native HLS source prepared alongside it.
      void prepareAirPlayAlternative();

      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const targetDelay = channel.mode === 'restream'
        ? envNumber(import.meta.env.VITE_STREAM_DELAY, 18)
        : envNumber(import.meta.env.VITE_STREAM_PROXY_DELAY, 30);
      const tolerance = envNumber(import.meta.env.VITE_SYNCHRONIZATION_TOLERANCE, 1.25);
      const maxDeviation = envNumber(import.meta.env.VITE_SYNCHRONIZATION_MAX_DEVIATION, 5);
      const adjustmentFactor = envNumber(import.meta.env.VITE_SYNCHRONIZATION_ADJUSTMENT, 0.02);
      const maxAdjustment = envNumber(import.meta.env.VITE_SYNCHRONIZATION_MAX_ADJUSTMENT, 0.04);

      const hls = new Hls({
        autoStartLoad: true,
        liveDurationInfinity: true,
        // AirPlay cannot send a MediaSource blob URL to a TV. On supported
        // Apple devices, ManagedMediaSource makes hls.js attach its local
        // source as a <source> element so the native HLS alternative above is
        // selected for full video AirPlay.
        preferManagedMediaSource: canUseAirPlay && canUseManagedMediaSource,
        // Synchronize against the media timeline rather than wall-clock time.
        // hls.js estimates the advancing edge between playlist refreshes.
        ...(syncEnabled
          ? { liveSyncDuration: targetDelay }
          : { liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6 }),
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

      let playbackStarted = false;
      const startPlaybackWhenReady = () => {
        if (playbackStarted) return;
        const details = hls.latestLevelDetails;
        if (!details) return;

        // A newly-created restream playlist grows from only a few segments.
        // Keep the muted player paused while hls.js refreshes that playlist so
        // playback can begin at the requested latency without a later jump.
        if (channel.mode === 'restream' && details.totalduration < targetDelay) {
          return;
        }

        playbackStarted = true;
        video.play()
          .then(() => {
            if (toastStartId) removeToast(toastStartId);
          })
          .catch((error) => {
            playbackStarted = false;
            console.warn('Synchronized playback could not start:', error);
          });
      };
      hls.on(Hls.Events.LEVEL_UPDATED, startPlaybackWhenReady);

      const hardCorrectionCooldownMs = 30_000;
      const hardCorrectionSampleCount = 5;
      let smoothedDeviation: number | null = null;
      let consecutiveLargeDeviations = 0;
      let lastHardCorrectionAt = performance.now();

      const correctPlayback = () => {
        const details = hls.latestLevelDetails;
        if (
          !playbackStarted
          || !details
          || video.paused
          || video.seeking
          || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
          return;
        }

        // Short upstream playlists may not retain the configured delay. In
        // that case, use the oldest sustainable point instead of continually
        // trying to seek outside the available timeline.
        const maximumAvailableDelay = Math.max(
          details.targetduration,
          details.totalduration - details.targetduration,
        );
        const effectiveTargetDelay = Math.min(targetDelay, maximumAvailableDelay);
        const rawDeviation = hls.latency - effectiveTargetDelay;
        const now = performance.now();

        consecutiveLargeDeviations = Math.abs(rawDeviation) > maxDeviation
          ? consecutiveLargeDeviations + 1
          : 0;

        if (consecutiveLargeDeviations >= hardCorrectionSampleCount
          && now - lastHardCorrectionAt >= hardCorrectionCooldownMs) {
          const targetTime = hls.liveSyncPosition;
          const seekableIndex = video.seekable.length - 1;
          if (
            targetTime !== null
            && seekableIndex >= 0
            && targetTime >= video.seekable.start(seekableIndex)
            && targetTime <= video.seekable.end(seekableIndex)
          ) {
            video.currentTime = targetTime;
            video.playbackRate = 1;
            smoothedDeviation = null;
            consecutiveLargeDeviations = 0;
            lastHardCorrectionAt = now;
            console.log('Sustained live-edge deviation detected. Realigning playback.');
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
        if (toastStartId) removeToast(toastStartId);
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

  }, [channel?.id, channel?.url, channel?.mode, syncEnabled, useCustomControls, addToast, clearToasts, removeToast]);

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

  const publishReaction = (emoji: string, userName: string) => {
    displayReaction(emoji, userName);
    if (!socketService.isConnected()) return;

    socketService.sendReaction(userName, emoji).catch((error) => {
      addToast({
        type: 'error',
        title: 'Reaction not shared',
        message: error instanceof Error ? error.message : 'The reaction could not be shared.',
        duration: 3000,
      });
    });
  };

  const sendReaction = (emoji: string) => {
    const currentUsername = username || readStoredUsername();
    if (!currentUsername) {
      pendingReactionRef.current = emoji;
      setIsUsernameModalOpen(true);
      return;
    }
    publishReaction(emoji, currentUsername);
  };

  const reactionTray = (
    <div className="reaction-tray" role="group" aria-label="Choose a reaction">
      {REACTIONS.map(({ emoji, label }) => (
        <button
          key={label}
          type="button"
          className="reaction-choice"
          aria-label={label}
          title={label}
          onClick={() => sendReaction(emoji)}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="video-player-stack">
      <div ref={frameRef} className="video-frame relative">
        <video
        ref={videoRef}
        className="block h-auto max-h-[calc(100vh-7rem)] w-full bg-black object-contain aspect-video"
        muted
        autoPlay={!syncEnabled}
          playsInline
          controls={!useCustomControls}
          onClick={useCustomControls ? togglePlayback : undefined}
        />
        <div className="reaction-flight-path" aria-hidden="true">
          {floatingReactions.map((reaction) => (
            <span
              key={reaction.id}
              className="floating-reaction"
              style={{
                left: `${reaction.left}%`,
                '--reaction-drift': `${reaction.drift}px`,
                '--reaction-rotation': `${reaction.rotation}deg`,
                '--reaction-duration': `${reaction.duration}ms`,
              } as CSSProperties}
            >
              <span className="reaction-emoji">{reaction.emoji}</span>
              <span className="reaction-identity">{reaction.userName}</span>
            </span>
          ))}
        </div>
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
          <div className="reaction-control">
            {reactionsOpen && reactionTray}
            <button
              type="button"
              onClick={() => setReactionsOpen((open) => !open)}
              aria-label="React to the video"
              aria-expanded={reactionsOpen}
              title="React"
              className={`reaction-trigger ${reactionsOpen ? 'reaction-trigger-active' : ''}`}
            >
              <SmilePlus className="h-5 w-5" />
            </button>
          </div>
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

      {!useCustomControls && (
        <div className="reaction-mobile-rail" role="toolbar" aria-label="Video reactions">
          <div className="reaction-mobile-rail-controls">
            {reactionsOpen && reactionTray}
            <button
              type="button"
              className={`reaction-trigger ${reactionsOpen ? 'reaction-trigger-active' : ''}`}
              aria-label="React to the video"
              aria-expanded={reactionsOpen}
              onClick={() => setReactionsOpen((open) => !open)}
            >
              <SmilePlus className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
      {isUsernameModalOpen && (
        <UsernameModal
          initialUsername=""
          isEditing={false}
          context="reactions"
          onCancel={() => {
            pendingReactionRef.current = null;
            setIsUsernameModalOpen(false);
          }}
          onSave={(nextUsername) => {
            storeUsername(nextUsername);
            setUsername(nextUsername);
            setIsUsernameModalOpen(false);
            const pendingReaction = pendingReactionRef.current;
            pendingReactionRef.current = null;
            if (pendingReaction) publishReaction(pendingReaction, nextUsername);
          }}
        />
      )}
    </div>
  );
}

export default VideoPlayer;
