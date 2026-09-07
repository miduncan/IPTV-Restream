export interface AdminSettings {
  transcodeAudioToAacLc: boolean;
  xtreamUrl: string;
  xtreamUsername: string;
  xtreamPassword: string;
}

export type AdminPageState = 'loading' | 'login' | 'ready' | 'error';
