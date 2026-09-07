import { useCallback, useEffect, useMemo, useState } from 'react';
import apiService from '../../services/ApiService';
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

  const loadSettings = useCallback(async () => {
    setPageState('loading');
    setMessage('');

    try {
      const response = await apiService.request<{ settings: AdminSettings }>('/admin/settings');
      setSettings(response.settings);
      setSavedSettings(response.settings);
      setPageState('ready');
    } catch (error) {
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
      setMessage(error instanceof Error ? error.message : 'Could not save settings');
    } finally {
      setIsSaving(false);
    }
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
    hasChanges,
    validationMessage,
    loadSettings,
    saveSettings,
    updateSetting,
  };
}
