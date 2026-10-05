import apiService, { ApiError } from './ApiService';

export interface ReceiverPlaybackSession {
  playbackUrl: string;
  expiresAt: string;
}

interface ReceiverPlaybackOptions {
  isCancelled?: () => boolean;
  retryWindowMs?: number;
}

export async function createReceiverPlaybackSession({
  isCancelled = () => false,
  retryWindowMs = 90_000,
}: ReceiverPlaybackOptions = {}): Promise<ReceiverPlaybackSession | null> {
  const deadline = Date.now() + retryWindowMs;

  while (!isCancelled()) {
    try {
      return await apiService.request<ReceiverPlaybackSession>('/airplay/sessions', 'POST');
    } catch (error) {
      const retryableStatus = error instanceof ApiError && [502, 503, 504].includes(error.status);
      const retryableNetworkError = error instanceof TypeError;
      if ((!retryableStatus && !retryableNetworkError) || Date.now() >= deadline) {
        throw error;
      }
      await new Promise(resolve => window.setTimeout(resolve, 1_000));
    }
  }

  return null;
}
