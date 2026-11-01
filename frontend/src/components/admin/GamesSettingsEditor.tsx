import { useEffect, useState } from 'react';
import apiService from '../../services/ApiService';
import { GAME_LEAGUES, GamesSettings } from '../gamesTypes';

function validateMatchingSchedule(settings: GamesSettings | null) {
  if (!settings) return '';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.matchingTime)) return 'Choose a daily matching time.';
  try {
    if (!settings.matchingTimezone || settings.matchingTimezone.length > 100) throw new Error();
    new Intl.DateTimeFormat('en-US', { timeZone: settings.matchingTimezone });
  } catch { return 'Use a valid timezone such as America/Los_Angeles or UTC.'; }
  return '';
}

export default function GamesSettingsEditor({ onSave }: { onSave?: () => void }) {
  const [settings, setSettings] = useState<GamesSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<GamesSettings | null>(null);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    apiService.request<{ settings: GamesSettings }>('/admin/games/settings').then(response => {
      if (active) { setSettings(response.settings); setSavedSettings(response.settings); }
    }).catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : 'Could not load Games settings');
    });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setIsSaving(true);
    setMessage('');
    try {
      const response = await apiService.request<{ settings: GamesSettings }>('/admin/games/settings', 'PUT', undefined, { settings });
      setSettings(response.settings);
      setSavedSettings(response.settings);
      setMessage('Games settings saved');
      onSave?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save Games settings');
    } finally { setIsSaving(false); }
  };
  const invalidDuration = settings && GAME_LEAGUES.some(league => !Number.isFinite(settings.estimatedDurationHours[league]) || settings.estimatedDurationHours[league] <= 0 || settings.estimatedDurationHours[league] > 24);
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const scheduleValidation = validateMatchingSchedule(settings);

  return <section className="mt-8" aria-label="Games settings">
    <h2 className="mb-3 text-sm font-medium text-[#DCE6EF]">Games</h2>
    <div className="admin-panel overflow-hidden px-5 py-5 sm:px-6">
      <p className="mb-4 text-xs leading-5 text-[#738496]">Choose the leagues available to everyone. Estimated durations apply when live status is unavailable.</p>
      {!settings ? <p className="text-sm text-[#91A0AF]" role="status">{message || 'Loading Games settings…'}</p> : <>
        <fieldset disabled={isSaving} className="space-y-5">
          {GAME_LEAGUES.map(league => <div key={league} className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Enable ${league} games`} checked={settings.enabledLeagues.includes(league)} className="accent-[#4EA1FF]"
              onChange={event => { setSettings({ ...settings, enabledLeagues: event.target.checked ? GAME_LEAGUES.filter(item => item === league || settings.enabledLeagues.includes(item)) : settings.enabledLeagues.filter(item => item !== league) }); setMessage(''); }} />{league}</label>
            <label className="flex items-center gap-3 text-xs text-[#91A0AF]">Estimated hours
              <input type="number" min="0.25" max="24" step="0.25" aria-label={`${league} estimated duration (hours)`} value={settings.estimatedDurationHours[league]} className="admin-input w-20 px-2 py-2"
                onChange={event => { setSettings({ ...settings, estimatedDurationHours: { ...settings.estimatedDurationHours, [league]: Number(event.target.value) } }); setMessage(''); }} />
            </label>
          </div>)}
          <div className="border-t border-[#233242] pt-5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Enable automatic game matching" checked={settings.matchingEnabled} className="accent-[#4EA1FF]"
              onChange={event => { setSettings({ ...settings, matchingEnabled: event.target.checked }); setMessage(''); }} />Enable daily matching</label>
            <p className="mt-2 text-xs leading-5 text-[#738496]">Enabling starts a matching run immediately and replaces today’s scheduled run. Use Run matching now above to refresh results manually.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(120px,0.5fr)_minmax(200px,1fr)]">
              <label className="block text-xs text-[#91A0AF]">Daily matching time
                <input type="time" aria-label="Daily matching time" value={settings.matchingTime} className="admin-input mt-2 w-full px-3 py-2.5"
                  onChange={event => { setSettings({ ...settings, matchingTime: event.target.value }); setMessage(''); }} />
              </label>
              <label className="block text-xs text-[#91A0AF]">Matching timezone
                <input type="text" aria-label="Matching timezone" value={settings.matchingTimezone} maxLength={100} placeholder="America/Los_Angeles" className="admin-input mt-2 w-full px-3 py-2.5"
                  onChange={event => { setSettings({ ...settings, matchingTimezone: event.target.value }); setMessage(''); }} />
              </label>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#738496]">The daily time uses this timezone. Matching covers live games and the next 48 hours; game status refreshes separately.</p>
          </div>
        </fieldset>
        {invalidDuration && <p className="mt-4 text-xs text-[#FF8B8B]">Estimated durations must be greater than zero and at most 24 hours.</p>}
        {scheduleValidation && <p className="mt-4 text-xs text-[#FF8B8B]">{scheduleValidation}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p role="status" className={`text-xs ${message === 'Games settings saved' ? 'text-[#44D492]' : 'text-[#FF8B8B]'}`}>{message}</p>
          <button type="button" onClick={() => void save()} disabled={!hasChanges || isSaving || Boolean(invalidDuration) || Boolean(scheduleValidation)} className="admin-primary px-4 py-2.5 text-sm">{isSaving ? 'Saving Games settings…' : 'Save Games settings'}</button>
        </div>
      </>}
    </div>
  </section>;
}
