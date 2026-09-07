import { Activity, Check, Loader, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { Setting } from './adminTypes';

interface SettingsEditorProps {
  hasChanges: boolean;
  isSaving: boolean;
  message: string;
  settings: Setting[];
  validationMessage: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  onUpdate: (index: number, field: 'key' | 'value', value: string) => void;
}

interface SettingRowProps {
  index: number;
  setting: Setting;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: 'key' | 'value', value: string) => void;
}

function SettingRow({ index, setting, onRemove, onUpdate }: SettingRowProps) {
  return (
    <div className="admin-setting-row grid gap-3 p-3 sm:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.4fr)_44px]">
      <label className="block">
        <span className="mb-1.5 block text-xs text-[#738496] sm:sr-only">Key</span>
        <input
          value={setting.key}
          onChange={(event) => onUpdate(index, 'key', event.target.value)}
          className="admin-input w-full px-3 py-2.5"
          placeholder="setting.key"
          maxLength={64}
          aria-label={`Setting ${index + 1} key`}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs text-[#738496] sm:sr-only">Value</span>
        <input
          value={setting.value}
          onChange={(event) => onUpdate(index, 'value', event.target.value)}
          className="admin-input w-full px-3 py-2.5"
          placeholder="Value"
          maxLength={4096}
          aria-label={`Setting ${index + 1} value`}
        />
      </label>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="admin-icon-button flex h-11 items-center justify-center self-end sm:self-auto"
        aria-label={`Remove ${setting.key || `setting ${index + 1}`}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function SettingsEditor({
  hasChanges,
  isSaving,
  message,
  settings,
  validationMessage,
  onAdd,
  onRemove,
  onSave,
  onUpdate,
}: SettingsEditorProps) {
  return (
    <section className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-5 border-b border-[#233242] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm text-[#44D492]">
              <Activity className="h-4 w-4" /> Server configuration
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Settings</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#91A0AF]">
              Values saved here are shared by the server. Keys may contain letters, numbers, periods, underscores, and hyphens.
            </p>
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="admin-secondary flex shrink-0 items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            <Plus className="h-4 w-4" /> Add setting
          </button>
        </div>

        <div className="mt-7">
          <div className="hidden grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.4fr)_44px] gap-3 px-3 pb-2 text-xs text-[#738496] sm:grid">
            <span>Key</span><span>Value</span><span className="sr-only">Actions</span>
          </div>

          {settings.length === 0 ? (
            <div className="admin-empty py-16 text-center">
              <Settings2 className="mx-auto h-6 w-6 text-[#617386]" />
              <h2 className="mt-4 font-medium">No server settings yet</h2>
              <p className="mt-1 text-sm text-[#91A0AF]">Add the first key and value to start configuring the server.</p>
              <button
                type="button"
                onClick={onAdd}
                className="admin-secondary mt-5 inline-flex items-center gap-2 px-4 py-2.5 text-sm"
              >
                <Plus className="h-4 w-4" /> Add setting
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {settings.map((setting, index) => (
                <SettingRow
                  key={`${setting.updatedAt || 'new'}-${index}`}
                  index={index}
                  setting={setting}
                  onRemove={onRemove}
                  onUpdate={onUpdate}
                />
              ))}
            </div>
          )}
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
