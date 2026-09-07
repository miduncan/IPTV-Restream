import { useCallback, useEffect, useMemo, useState } from 'react';
import apiService, { ApiError } from '../../services/ApiService';
import { AdminPageState, Setting } from './adminTypes';

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;

function validateSettings(settings: Setting[]) {
  const keys = new Set<string>();

  for (const setting of settings) {
    const key = setting.key.trim();
    if (!KEY_PATTERN.test(key)) {
      return key ? `Invalid setting key: ${key}` : 'Every setting needs a key';
    }
    if (setting.value.length > 4096) return `The value for ${key} is too long`;
    if (keys.has(key.toLowerCase())) return `Duplicate setting key: ${key}`;
    keys.add(key.toLowerCase());
  }

  return '';
}

export function useAdminSettings() {
  const [pageState, setPageState] = useState<AdminPageState>('loading');
  const [settings, setSettings] = useState<Setting[]>([]);
  const [savedSettings, setSavedSettings] = useState<Setting[]>([]);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [authRequired, setAuthRequired] = useState(true);

  const loadSettings = useCallback(async () => {
    setPageState('loading');
    setMessage('');

    try {
      const status = await apiService.request<{ enabled: boolean }>('/auth/admin-status');
      setAuthRequired(status.enabled);
      const response = await apiService.request<{ settings: Setting[] }>('/admin/settings');
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
      const response = await apiService.request<{ settings: Setting[] }>(
        '/admin/settings',
        'PUT',
        undefined,
        { settings: settings.map(({ key, value }) => ({ key: key.trim(), value })) }
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
    setSettings([]);
    setSavedSettings([]);
    setPageState('login');
    setMessage('');
  };

  const updateSetting = (index: number, field: 'key' | 'value', value: string) => {
    setSettings((current) =>
      current.map((setting, settingIndex) =>
        settingIndex === index ? { ...setting, [field]: value } : setting
      )
    );
    setMessage('');
  };

  const removeSetting = (index: number) => {
    setSettings((current) => current.filter((_, settingIndex) => settingIndex !== index));
    setMessage('');
  };

  const addSetting = () => {
    setSettings((current) => [...current, { key: '', value: '' }]);
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
    removeSetting,
    addSetting,
  };
}
