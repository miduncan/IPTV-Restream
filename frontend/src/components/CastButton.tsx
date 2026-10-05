import { useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Channel } from '../types';
import castService from '../services/CastService';
import { createReceiverPlaybackSession } from '../services/ReceiverPlaybackService';
import { ToastContext } from './notifications/ToastContext';

interface CastButtonProps {
  channel: Channel | null;
  onRemotePlaybackEnded: () => void;
  onRemotePlaybackStarted: () => void;
}

const launcherStyle = {
  '--connected-color': '#4EA1FF',
  '--disconnected-color': 'currentColor',
} as CSSProperties;

function CastButton({ channel, onRemotePlaybackEnded, onRemotePlaybackStarted }: CastButtonProps) {
  const [sdkReady, setSdkReady] = useState(false);
  const channelRef = useRef(channel);
  const activeChannelIdRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const remotePlaybackStartedRef = useRef(false);
  const { addToast } = useContext(ToastContext);

  channelRef.current = channel;

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;

    void castService.initialize().then(ready => {
      if (cancelled || !ready) return;
      setSdkReady(true);

      unsubscribe = castService.subscribeToSessionState(event => {
        const states = castService.sessionStates();
        if (!states) return;

        if (event.sessionState === states.SESSION_STARTED) {
          const selectedChannel = channelRef.current;
          if (!selectedChannel) {
            castService.endCurrentSession();
            return;
          }

          const generation = loadGenerationRef.current + 1;
          loadGenerationRef.current = generation;
          activeChannelIdRef.current = selectedChannel.id;

          void createReceiverPlaybackSession({
            isCancelled: () => cancelled || loadGenerationRef.current !== generation,
          }).then(async playbackSession => {
            if (!playbackSession || cancelled || loadGenerationRef.current !== generation) return;
            if (channelRef.current?.id !== selectedChannel.id) {
              castService.endCurrentSession();
              return;
            }

            await castService.loadMedia(playbackSession.playbackUrl, selectedChannel);
            if (cancelled || loadGenerationRef.current !== generation) return;
            remotePlaybackStartedRef.current = true;
            onRemotePlaybackStarted();
          }).catch(error => {
            if (cancelled || loadGenerationRef.current !== generation) return;
            console.error('Could not load the stream on Google Cast:', error);
            activeChannelIdRef.current = null;
            castService.endCurrentSession();
            addToast({
              type: 'error',
              title: 'Could not start casting',
              message: 'The TV could not play this stream.',
              duration: 5000,
            });
          });
          return;
        }

        if (event.sessionState === states.SESSION_RESUMED) {
          const selectedChannel = channelRef.current;
          if (!selectedChannel) return;
          activeChannelIdRef.current = selectedChannel.id;
          if (!remotePlaybackStartedRef.current) {
            remotePlaybackStartedRef.current = true;
            onRemotePlaybackStarted();
          }
          return;
        }

        if (event.sessionState === states.SESSION_START_FAILED) {
          console.error('Google Cast session could not start:', event.errorCode);
          addToast({
            type: 'error',
            title: 'Could not start casting',
            message: 'No connection was made to the TV.',
            duration: 5000,
          });
        }

        if (event.sessionState === states.SESSION_ENDED) {
          loadGenerationRef.current += 1;
          activeChannelIdRef.current = null;
          if (remotePlaybackStartedRef.current) {
            remotePlaybackStartedRef.current = false;
            onRemotePlaybackEnded();
          }
        }
      });

      const selectedChannel = channelRef.current;
      if (castService.hasCurrentSession() && selectedChannel && !remotePlaybackStartedRef.current) {
        activeChannelIdRef.current = selectedChannel.id;
        remotePlaybackStartedRef.current = true;
        onRemotePlaybackStarted();
      }
    });

    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
      unsubscribe();
    };
  }, [addToast, onRemotePlaybackEnded, onRemotePlaybackStarted]);

  useEffect(() => {
    const activeChannelId = activeChannelIdRef.current;
    if (activeChannelId === null || activeChannelId === channel?.id) return;

    loadGenerationRef.current += 1;
    activeChannelIdRef.current = null;
    castService.endCurrentSession();
    if (remotePlaybackStartedRef.current) {
      remotePlaybackStartedRef.current = false;
      onRemotePlaybackEnded();
    }
  }, [channel?.id, onRemotePlaybackEnded]);

  if (!sdkReady || !channel) return null;

  return (
    <google-cast-launcher
      aria-label="Cast"
      class="cast-launcher"
      style={launcherStyle}
      title="Cast"
    />
  );
}

export default CastButton;
