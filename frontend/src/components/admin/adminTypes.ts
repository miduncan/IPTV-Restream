export interface Setting {
  key: string;
  value: string;
  updatedAt?: string;
}

export type AdminPageState = 'loading' | 'login' | 'ready' | 'error';
