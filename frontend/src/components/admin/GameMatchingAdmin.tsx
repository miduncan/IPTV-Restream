import { useCallback, useEffect, useState } from 'react';
import apiService from '../../services/ApiService';
import GameMatchingControls from '../GameMatchingControls';
import GamesSettingsEditor from './GamesSettingsEditor';
import GameCandidates from '../GameCandidates';
import GameCoverage, { DiscoveryCoverage } from '../GameCoverage';
import { Game } from '../GamesPanel';
import { GameMatching, MatchingStatus } from '../gameMatchingTypes';
import { GamesSettings } from '../gamesTypes';

interface History {
  matches: { game: Game; matching: GameMatching }[];
  matching: MatchingStatus;
  coverage: DiscoveryCoverage | null;
  settings: GamesSettings;
}
interface Categories {
  categories: { id: string; name: string; channelCount: number }[];
  allowedCategoryIds: string[];
}

export default function GameMatchingAdmin() {
  const [history, setHistory] = useState<History | null>(null);
  const [categories, setCategories] = useState<Categories | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: number;
    const load = async () => {
      let running = false;
      try {
        const result = await apiService.request<History>('/admin/games/matching');
        if (active) { setHistory(result); setError(''); running = result.matching.running; }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load matching history');
      } finally {
        if (active) timer = window.setTimeout(load, running ? 2000 : 30000);
      }
    };
    void load();
    return () => { active = false; window.clearTimeout(timer); };
  }, [version]);

  const loadCategories = useCallback(async () => {
    setCategoryError('');
    try {
      const result = await apiService.request<Categories>('/admin/games/matching/categories');
      setCategories(result); setSelected(result.allowedCategoryIds);
    } catch (failure) {
      setCategoryError(failure instanceof Error ? failure.message : 'Could not load categories');
    }
  }, []);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

  const save = async () => {
    setSaving(true); setMessage(''); setCategoryError('');
    try {
      const result = await apiService.request<{ allowedCategoryIds: string[] }>('/admin/games/matching/categories', 'PUT', undefined, { allowedCategoryIds: selected });
      setCategories(current => current ? { ...current, ...result } : current);
      setSelected(result.allowedCategoryIds);
      setMessage('Categories saved. Run matching now to refresh the results.');
      setVersion(value => value + 1);
    } catch (failure) {
      setCategoryError(failure instanceof Error ? failure.message : 'Could not save categories');
    } finally { setSaving(false); }
  };
  const changed = Boolean(categories && JSON.stringify([...selected].sort()) !== JSON.stringify([...categories.allowedCategoryIds].sort()));
  const matches = history?.matches.filter(({ game, matching }) => `${game.league} ${game.name || game.teams.map(team => team.name).join(' ')} ${matching.candidates.map(candidate => candidate.name).join(' ')}`.toLowerCase().includes(query.toLowerCase())) || [];
  const knownIds = new Set(categories?.categories.map(category => category.id));
  const missingIds = selected.filter(id => !knownIds.has(id));

  return <section className="min-w-0 px-5 py-8 sm:px-8" aria-label="Game channel matching">
    <h1 className="text-2xl font-semibold tracking-tight">Game channel matching</h1>
    <p className="mt-2 text-sm text-[#91A0AF]">Review the last 48 hours of matching results, candidate channels, and scoring evidence.</p>
    <div className="admin-panel mt-6 p-5">
      {history && !history.matching.lastSuccessfulAt && <p className="mb-3 text-sm text-[#91A0AF]">No successful matching run recorded.</p>}
      {history?.matching.lastAttemptAt && <p className="mb-3 text-xs text-[#91A0AF]">Last attempt: {new Date(history.matching.lastAttemptAt).toLocaleString()}</p>}
      <GameMatchingControls matching={history?.matching} isAdmin onRun={() => setVersion(value => value + 1)} />
      {history && <GameCoverage guideLimitations={history.matching.guideCoverage?.limitations} />}
      {error && <p role="alert" className="text-sm text-[#FF8B8B]">{error}</p>}
    </div>

    <GamesSettingsEditor onSave={() => setVersion(value => value + 1)} />

    <section className="admin-panel mt-6 p-5" aria-label="Matching category allow-list">
      <h2 className="text-lg font-semibold">Eligible channel categories</h2>
      <p className="mt-2 text-sm text-[#91A0AF]">Only allow-listed categories are considered for matching. No categories selected means no eligible channels. Uncategorized channels are excluded.</p>
      {categories ? <>
        <label className="mt-4 block text-sm text-[#91A0AF]">Find categories
          <input className="admin-input mt-2 w-full px-3 py-2" value={categoryQuery} onChange={event => setCategoryQuery(event.target.value)} type="search" />
        </label>
        <fieldset disabled={saving} className="mt-4 max-h-72 overflow-y-auto rounded-md border border-[#233242] p-3">
          <legend className="px-1 text-xs text-[#91A0AF]">{selected.length} {selected.length === 1 ? 'category' : 'categories'} allowed</legend>
          {categories.categories.filter(category => category.name.toLowerCase().includes(categoryQuery.toLowerCase())).map(category => <label key={category.id} className="flex items-center gap-3 border-b border-[#233242] py-2 text-sm last:border-0">
            <input type="checkbox" className="accent-[#4EA1FF]" checked={selected.includes(category.id)} onChange={event => { setSelected(current => event.target.checked ? [...current, category.id] : current.filter(id => id !== category.id)); setMessage(''); }} />
            <span className="flex-1">{category.name} <span className="text-xs text-[#91A0AF]">(ID {category.id})</span></span>
            <span className="text-xs text-[#91A0AF]">{category.channelCount} channels</span>
          </label>)}
          {missingIds.map(id => <label key={id} className="flex items-center gap-3 py-2 text-sm text-[#D7A94B]"><input type="checkbox" checked onChange={() => setSelected(current => current.filter(value => value !== id))} />Unavailable category {id}</label>)}
          {!categories.categories.length && <p className="text-sm text-[#91A0AF]">No provider categories found. Check your provider settings.</p>}
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-[#70E0AE]">{message}</p>
          <button type="button" disabled={saving || !changed} onClick={() => void save()} className="admin-primary px-4 py-2 text-sm">{saving ? 'Saving…' : 'Save category allow-list'}</button>
        </div>
      </> : !categoryError && <p className="mt-4 text-sm text-[#91A0AF]">Loading categories…</p>}
      {categoryError && <div className="mt-4 text-sm text-[#FF8B8B]" role="alert">{categoryError} {!categories && <button type="button" className="admin-secondary ml-3 px-3 py-2" onClick={() => void loadCategories()}>Retry categories</button>}</div>}
    </section>

    <section className="mt-8" aria-label="Matching results">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Matches <span className="text-sm font-normal text-[#91A0AF]">{history ? `${matches.length} ${matches.length === 1 ? 'game' : 'games'}` : ''}</span></h2>
        <input type="search" aria-label="Search matching results" placeholder="Search games or channels" value={query} onChange={event => setQuery(event.target.value)} className="admin-input w-full px-3 py-2 sm:w-72" />
      </div>
      <p className="mt-2 text-xs text-[#91A0AF]">Latest stored result per game, matched in the past 48 hours. Includes upcoming and finished games. Scores rank feeds; they are not probabilities.</p>
      {!history && !error && <p className="mt-5 text-sm text-[#91A0AF]">Loading matches…</p>}
      {history && !matches.length && <p className="admin-panel mt-5 p-5 text-sm text-[#91A0AF]">{query ? 'No games or channels match your search.' : 'No matching results in the past 48 hours. Select eligible categories, save, then run matching now.'}</p>}
      <div className="mt-5 space-y-3">
        {matches.map(({ game, matching }) => <details key={game.id} className="admin-panel p-5">
          <summary className="cursor-pointer text-sm">
            <span className="font-semibold">{game.name || game.teams.map(team => team.name).join(' vs ')}</span>
            <span className="ml-3 text-[#91A0AF]">{game.league} · {matching.candidates.length} candidate channels</span>
            <span className="mt-2 block text-xs text-[#91A0AF]">Starts {new Date(game.startsAt).toLocaleString()} · {game.statusDetail || game.status} · Matched {new Date(matching.matchedAt!).toLocaleString()}</span>
          </summary>
          <div className="mt-4 border-t border-[#233242] pt-4 text-sm text-[#91A0AF]">
            <GameCandidates gameId={game.id} matchingVersion={matching.matchedAt || ''} canSelect={false} inspectionOnly storedResult={matching} />
          </div>
        </details>)}
      </div>
    </section>
  </section>;
}
