import { Activity, Check, Eye, EyeOff, Loader, Radio, RefreshCw, Save } from 'lucide-react';
import { useState } from 'react';
import { AdminSettings } from './adminTypes';
import apiService from '../../services/ApiService';

interface SettingsEditorProps {
  hasChanges: boolean;
  isSaving: boolean;
  message: string;
  settings: AdminSettings;
  validationMessage: string;
  onSave: () => void;
  onUpdate: <Key extends keyof AdminSettings>(key: Key, value: AdminSettings[Key]) => void;
}

interface TextSettingProps {
  autoComplete?: string;
  description: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: 'text' | 'password';
  value: string;
}

function TextSetting({
  autoComplete,
  description,
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}: TextSettingProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && !showPassword ? 'password' : 'text';

  return (
    <label className="block border-b border-[#233242] px-5 py-5 last:border-b-0 sm:grid sm:grid-cols-[minmax(180px,0.75fr)_minmax(260px,1.25fr)] sm:items-center sm:gap-8 sm:px-6">
      <span>
        <span className="block text-sm font-medium text-[#EAF0F6]">{label}</span>
        <span className="mt-1 block max-w-sm text-xs leading-5 text-[#738496]">{description}</span>
      </span>
      <span className="relative mt-3 block sm:mt-0">
        <input
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`admin-input w-full px-3 py-2.5 ${isPassword ? 'pr-11' : ''}`}
          placeholder={placeholder}
          maxLength={4096}
          autoComplete={autoComplete}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            className="admin-password-toggle absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#738496]"
            aria-label={showPassword ? 'Hide Xtream password' : 'Show Xtream password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </span>
    </label>
  );
}

function SettingsEditor({
  hasChanges,
  isSaving,
  message,
  settings,
  validationMessage,
  onSave,
  onUpdate,
}: SettingsEditorProps) {
  const [isClearingEpg, setIsClearingEpg] = useState(false);
  const [epgMessage, setEpgMessage] = useState('');

  const clearEpgCache = async () => {
    setIsClearingEpg(true);
    setEpgMessage('');
    try {
      const response = await apiService.request<{ cleared: number }>('/admin/epg-cache', 'DELETE');
      setEpgMessage(response.cleared === 1 ? 'Cleared 1 cached channel' : `Cleared ${response.cleared} cached channels`);
    } catch (error) {
      setEpgMessage(error instanceof Error ? error.message : 'Could not clear the EPG cache');
    } finally {
      setIsClearingEpg(false);
    }
  };

  return (
    <section className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="border-b border-[#233242] pb-7">
          <div className="mb-3 flex items-center gap-2 text-sm text-[#44D492]">
            <Activity className="h-4 w-4" /> Server configuration
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#91A0AF]">
            Configure stream processing and the Xtream account used by the server.
          </p>
        </div>

        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#DCE6EF]">
            <Radio className="h-4 w-4 text-[#4EA1FF]" /> Stream processing
          </div>
          <div className="admin-panel overflow-hidden">
            <div className="flex items-center justify-between gap-8 border-b border-[#233242] px-5 py-5 sm:px-6">
              <div>
                <h2 className="text-sm font-medium">Synchronize playback</h2>
                <p className="mt-1 max-w-xl text-xs leading-5 text-[#738496]">Keep playback aligned for everyone watching. Streams may take longer to start.</p>
              </div>
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-3">
                <span className="hidden text-xs text-[#91A0AF] sm:inline">{settings.streamSynchronizationEnabled ? 'Enabled' : 'Disabled'}</span>
                <input type="checkbox" className="sr-only" checked={settings.streamSynchronizationEnabled} onChange={(event) => onUpdate('streamSynchronizationEnabled', event.target.checked)} />
                <span className="admin-toggle relative block h-7 w-12 rounded-full" aria-hidden="true"><span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-[#91A0AF] transition-transform" /></span>
              </label>
            </div>
            <div className="flex items-center justify-between gap-8 px-5 py-5 sm:px-6">
              <div>
                <h2 className="text-sm font-medium">Transcode audio to AAC-LC</h2>
                <p className="mt-1 max-w-xl text-xs leading-5 text-[#738496]">Copy the video stream and convert audio to stereo AAC-LC at 128 kbps. Leave this off to copy both streams unchanged.</p>
              </div>
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-3">
                <span className="hidden text-xs text-[#91A0AF] sm:inline">{settings.transcodeAudioToAacLc ? 'Enabled' : 'Disabled'}</span>
                <input type="checkbox" className="sr-only" checked={settings.transcodeAudioToAacLc} onChange={(event) => onUpdate('transcodeAudioToAacLc', event.target.checked)} />
                <span className="admin-toggle relative block h-7 w-12 rounded-full" aria-hidden="true"><span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-[#91A0AF] transition-transform" /></span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#DCE6EF]">
            <Radio className="h-4 w-4 text-[#4EA1FF]" /> Xtream connection
          </div>
          <div className="admin-panel overflow-hidden">
            <TextSetting
              label="Xtream URL"
              description="Portal base URL, including the port when required."
              placeholder="https://provider.example.com:8080"
              value={settings.xtreamUrl}
              onChange={(value) => onUpdate('xtreamUrl', value)}
              autoComplete="url"
            />
            <TextSetting
              label="Xtream username"
              description="Username supplied by your IPTV provider."
              placeholder="Username"
              value={settings.xtreamUsername}
              onChange={(value) => onUpdate('xtreamUsername', value)}
              autoComplete="username"
            />
            <TextSetting
              label="Xtream password"
              description="Stored in the server SQLite database as plain text."
              placeholder="Password"
              value={settings.xtreamPassword}
              onChange={(value) => onUpdate('xtreamPassword', value)}
              type="password"
              autoComplete="current-password"
            />
            <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="text-sm font-medium">EPG cache</h2>
                <p className="mt-1 max-w-xl text-xs leading-5 text-[#738496]">Programme data refreshes when the current show ends. Clear it to force fresh data on the next player request.</p>
                {epgMessage && <p className="mt-1.5 text-xs text-[#91A0AF]" aria-live="polite">{epgMessage}</p>}
              </div>
              <button type="button" onClick={clearEpgCache} disabled={isClearingEpg} className="admin-secondary flex shrink-0 items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${isClearingEpg ? 'animate-spin' : ''}`} />
                {isClearingEpg ? 'Clearing' : 'Clear EPG cache'}
              </button>
            </div>
          </div>
        </div>

        <footer className="mt-7 flex flex-col-reverse gap-3 border-t border-[#233242] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className={`flex items-center gap-2 text-sm ${message === 'Settings saved' ? 'text-[#44D492]' : 'text-[#FF8B8B]'}`} aria-live="polite">
            {message === 'Settings saved' && <Check className="h-4 w-4" />}
            {validationMessage || message}
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={!hasChanges || isSaving || Boolean(validationMessage)}
            className="admin-primary flex items-center justify-center gap-2 px-5 py-2.5 text-sm"
          >
            {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Saving' : 'Save changes'}
          </button>
        </footer>
      </div>
    </section>
  );
}

export default SettingsEditor;
