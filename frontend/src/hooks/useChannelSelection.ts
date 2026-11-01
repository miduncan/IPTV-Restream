import { useCallback, useEffect, useRef, useState } from 'react';
import { Channel } from '../types';
import socketService from '../services/SocketService';

type ChannelTarget = { name: string } & (
  | { kind: 'saved'; id: number }
  | { kind: 'provider'; sourceId: string }
);

const SKIP_CONFIRMATION_KEY = 'streamhub:skip-channel-change-confirmation';

function shouldSkipConfirmation() {
  try { return localStorage.getItem(SKIP_CONFIRMATION_KEY) === 'true'; } catch { return false; }
}

export default function useChannelSelection({ selectedChannel, checkPermission, onChangeStarted }: {
  selectedChannel: Channel | null;
  checkPermission: () => boolean;
  onChangeStarted: () => void;
}) {
  const [pendingChannel, setPendingChannel] = useState<ChannelTarget | null>(null);
  const pending = useRef<{
    target: ChannelTarget;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null>(null);

  const cancelChannelChange = useCallback(() => {
    pending.current?.resolve();
    pending.current = null;
    setPendingChannel(null);
  }, []);

  useEffect(() => () => { pending.current?.resolve(); }, []);

  const changeChannel = useCallback(async (target: ChannelTarget) => {
    if (!checkPermission()) return;
    onChangeStarted();
    if (target.kind === 'saved') await socketService.setCurrentChannel(target.id);
    else await socketService.setCurrentProviderChannel(target.sourceId);
  }, [checkPermission, onChangeStarted]);

  const requestChannelChange = useCallback((target: ChannelTarget): Promise<void> => {
    const id = target.kind === 'saved' ? target.id : -Number(target.sourceId);
    if (id === selectedChannel?.id || !checkPermission()) return Promise.resolve();
    if (shouldSkipConfirmation()) return changeChannel(target);

    return new Promise((resolve, reject) => {
      pending.current?.resolve();
      pending.current = { target, resolve, reject };
      setPendingChannel(target);
    });
  }, [selectedChannel, checkPermission, changeChannel]);

  const confirmChannelChange = useCallback((dontShowAgain: boolean) => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    setPendingChannel(null);
    if (dontShowAgain) {
      try { localStorage.setItem(SKIP_CONFIRMATION_KEY, 'true'); } catch { /* Selection works without storage. */ }
    }
    void changeChannel(request.target).then(request.resolve, request.reject);
  }, [changeChannel]);

  return { requestChannelChange, pendingChannel, cancelChannelChange, confirmChannelChange };
}
