import { useCallback, useEffect, useMemo, useState } from 'react';
import apiService, { ApiError } from '../../services/ApiService';
import { AdminPageState, AdminSettings } from './adminTypes';

const DEFAULT_SETTINGS: AdminSettings = {
  streamSynchronizationEnabled: false,
  transcodeAudioToAacLc: false,
  xtreamUrl: '',
  xtreamUsername: '',
  xtreamPassword: '',
};

function validateSettings(settings: AdminSettings) {
  if (settings.xtreamUrl) {
    try {
      const url = new URL(settings.xtreamUrl.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      return 'Xtream URL must be a valid HTTP or HTTPS URL';
    }
  }

  return '';
}

export function useAdminSettings() {
  const [pageState, setPageState] = useState<AdminPageState>('loading');
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [authRequired, setAuthRequired] = useState(true);

  const loadSettings = useCallback(async () => {
    setPageState('loading');
    setMessage('');

    try {
      const status = await apiService.request<{ enabled: boolean }>('/auth/admin-status');
      setAuthRequired(status.enabled);
      const response = await apiService.request<{ settings: AdminSettings }>('/admin/settings');
      setSettings(response.settings);
      setSavedSettings(response.settings);
      setPageState('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPageState('login');
        return;
      }

      setMessage(error instanceof Error ? error.message : 'Could not load settings');
      setPageState('error');
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const hasChanges = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings]
  );
  const validationMessage = useMemo(() => validateSettings(settings), [settings]);

  const login = async (password: string) => {
    setMessage('');

    try {
      const response = await apiService.request<{ success: boolean; token?: string }>(
        '/auth/admin-login',
        'POST',
        undefined,
        { password }
      );

      if (!response.token) throw new Error('The server did not return an access token');
      localStorage.setItem('admin_token', response.token);
      await loadSettings();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in');
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    setMessage('');

    try {
      const response = await apiService.request<{ settings: AdminSettings }>(
        '/admin/settings',
        'PUT',
        undefined,
        { settings }
      );
      setSettings(response.settings);
      setSavedSettings(response.settings);
      setMessage('Settings saved');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem('admin_token');
        setPageState('login');
      }
      setMessage(error instanceof Error ? error.message : 'Could not save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem('admin_token');
    setSettings(DEFAULT_SETTINGS);
    setSavedSettings(DEFAULT_SETTINGS);
    setPageState('login');
    setMessage('');
  };

  const updateSetting = <Key extends keyof AdminSettings>(key: Key, value: AdminSettings[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage('');
  };

  return {
    pageState,
    settings,
    message,
    isSaving,
    authRequired,
    hasChanges,
    validationMessage,
    loadSettings,
    login,
    saveSettings,
    signOut,
    updateSetting,
  };
}
