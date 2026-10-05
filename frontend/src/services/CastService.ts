import type { Channel } from '../types';

const CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const CAST_SDK_SCRIPT_ID = 'google-cast-sdk';
const HLS_CONTENT_TYPE = 'application/vnd.apple.mpegurl';

interface CastSessionLike {
  loadMedia(request: unknown): Promise<unknown>;
}

interface CastContextLike {
  addEventListener(type: string, listener: (event: CastSessionStateEvent) => void): void;
  removeEventListener(type: string, listener: (event: CastSessionStateEvent) => void): void;
  endCurrentSession(stopCasting: boolean): void;
  getCurrentSession(): CastSessionLike | null;
  setOptions(options: { receiverApplicationId: string; autoJoinPolicy: string }): void;
}

interface CastSessionStateEvent {
  errorCode?: string;
  sessionState: string;
}

interface MediaInfoLike {
  metadata?: GenericMediaMetadataLike;
  streamType?: string;
}

interface GenericMediaMetadataLike {
  images?: unknown[];
  subtitle?: string;
  title?: string;
}

interface CastFrameworkLike {
  CastContext: { getInstance(): CastContextLike };
  CastContextEventType: { SESSION_STATE_CHANGED: string };
  SessionState: {
    SESSION_ENDED: string;
    SESSION_RESUMED: string;
    SESSION_STARTED: string;
    SESSION_START_FAILED: string;
  };
}

interface ChromeCastLike {
  AutoJoinPolicy: { ORIGIN_SCOPED: string };
  Image: new (url: string) => unknown;
  media: {
    DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    GenericMediaMetadata: new () => GenericMediaMetadataLike;
    LoadRequest: new (mediaInfo: MediaInfoLike) => unknown;
    MediaInfo: new (contentId: string, contentType: string) => MediaInfoLike;
    StreamType: { LIVE: string };
  };
}

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean, errorInfo?: unknown) => void;
    cast?: { framework: CastFrameworkLike };
    chrome?: { cast?: ChromeCastLike };
  }
}

let initialization: Promise<boolean> | null = null;
let initialized = false;

function castApi() {
  const framework = window.cast?.framework;
  const chromeCast = window.chrome?.cast;
  return framework && chromeCast ? { framework, chromeCast } : null;
}

function initializeContext() {
  if (initialized) return true;
  const api = castApi();
  if (!api) return false;

  api.framework.CastContext.getInstance().setOptions({
    receiverApplicationId: api.chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: api.chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  initialized = true;
  return true;
}

function initialize(): Promise<boolean> {
  if (initialization) return initialization;
  if (window.location.protocol !== 'https:') return Promise.resolve(false);

  initialization = new Promise(resolve => {
    if (initializeContext()) {
      resolve(true);
      return;
    }

    const previousCallback = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable, errorInfo) => {
      previousCallback?.(isAvailable, errorInfo);
      resolve(isAvailable && initializeContext());
    };

    const existingScript = document.getElementById(CAST_SDK_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = CAST_SDK_SCRIPT_ID;
    script.src = CAST_SDK_URL;
    script.async = true;
    script.addEventListener('error', () => resolve(false), { once: true });
    document.head.appendChild(script);
  });

  return initialization;
}

function subscribeToSessionState(listener: (event: CastSessionStateEvent) => void) {
  const api = castApi();
  if (!api || !initialized) return () => undefined;

  const eventType = api.framework.CastContextEventType.SESSION_STATE_CHANGED;
  const context = api.framework.CastContext.getInstance();
  context.addEventListener(eventType, listener);
  return () => context.removeEventListener(eventType, listener);
}

async function loadMedia(playbackUrl: string, channel: Channel) {
  const api = castApi();
  if (!api || !initialized) throw new Error('Google Cast is not initialized.');

  const session = api.framework.CastContext.getInstance().getCurrentSession();
  if (!session) throw new Error('No Google Cast session is connected.');

  const mediaInfo = new api.chromeCast.media.MediaInfo(playbackUrl, HLS_CONTENT_TYPE);
  mediaInfo.streamType = api.chromeCast.media.StreamType.LIVE;

  const metadata = new api.chromeCast.media.GenericMediaMetadata();
  metadata.title = channel.name;
  metadata.subtitle = 'Live';
  if (channel.avatar) {
    try {
      metadata.images = [new api.chromeCast.Image(new URL(channel.avatar, window.location.href).href)];
    } catch (error) {
      console.warn('Channel artwork could not be added to Google Cast metadata:', error);
    }
  }
  mediaInfo.metadata = metadata;

  await session.loadMedia(new api.chromeCast.media.LoadRequest(mediaInfo));
}

function endCurrentSession() {
  const api = castApi();
  if (!api || !initialized) return;
  api.framework.CastContext.getInstance().endCurrentSession(true);
}

function hasCurrentSession() {
  const api = castApi();
  return Boolean(api && initialized && api.framework.CastContext.getInstance().getCurrentSession());
}

function sessionStates() {
  return castApi()?.framework.SessionState ?? null;
}

const castService = {
  endCurrentSession,
  hasCurrentSession,
  initialize,
  loadMedia,
  sessionStates,
  subscribeToSessionState,
};

export default castService;
