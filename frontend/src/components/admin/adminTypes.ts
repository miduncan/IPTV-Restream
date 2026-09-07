export interface AdminSettings {
  streamSynchronizationEnabled: boolean;
  transcodeAudioToAacLc: boolean;
  xtreamUrl: string;
  xtreamUsername: string;
  xtreamPassword: string;
}

export type AdminPageState = 'loading' | 'ready' | 'error';
