import { useEffect, useState } from 'react';
import { Clock3, ChevronDown } from 'lucide-react';
import apiService from '../services/ApiService';
import GameCandidates from './GameCandidates';
import { CandidateChannel, GameMatching, MatchingStatus } from './gameMatchingTypes';
import { GamesSettings } from './gamesTypes';
import { DiscoveryCoverage } from './GameCoverage';
import NamedEventCard, { NamedEvent } from './NamedEventCard';
import nflLogo from '../assets/events/nfl.png';

const eventLogos: Record<string, string> = { nfl: nflLogo, 'nfl-redzone': nflLogo };

export interface Game {
  id: string;
  name?: string;
  league: string;
  teams: { id: string; name: string; shortName: string; location?: string | null; abbreviation?: string; logo?: string | null; darkLogo?: string | null; score?: number | null }[];
  startsAt: string;
  status: string;
  statusDetail: string;
  group: 'live' | 'startingSoon' | 'recentlyFinished';
  statusEstimated: boolean;
  stale: boolean;
  matching: GameMatching & { count?: number };
}

export interface GamesResponse {
  games: Game[];
  namedEvents?: NamedEvent[];
  freshness: { stale: boolean; lastSuccessfulStatusAt: string | null; error: string | null };
  coverage: DiscoveryCoverage | null;
  matching?: MatchingStatus;
  settings?: GamesSettings;
}

const groups = [
  { id: 'live', label: 'Live' },
  { id: 'startingSoon', label: 'Starting soon' },
  { id: 'recentlyFinished', label: 'Recently finished' },
] as const;

function statusLabel(game: Game) {
  if (game.stale && game.status === 'live') return 'Last reported live · stale';
  if (game.statusEstimated) return `Estimated ${game.group === 'live' ? 'live' : game.group === 'recentlyFinished' ? 'finished' : 'start'}`;
  return game.statusDetail || (game.group === 'live' ? 'Live' : game.group === 'recentlyFinished' ? 'Final' : 'Scheduled');
}

function TeamLogo({ team }: { team: Game['teams'][number] }) {
  const [attempt, setAttempt] = useState(0);
  const sources = [...new Set([team.darkLogo, team.logo].filter((url): url is string => Boolean(url)))];
  const source = sources[attempt];
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">
    {source
      ? <img src={source} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setAttempt(current => current + 1)} />
      : <span className="flex h-full w-full items-center justify-center rounded-md bg-[#233242] text-[10px] font-bold text-[#DCE6EF]">{team.abbreviation || team.name.split(' ').map(word => word[0]).join('').slice(0, 3)}</span>}
  </span>;
}

export default function GamesPanel({ isActive, canSelect = true, onSelectCandidate }: { isActive: boolean; canSelect?: boolean; onSelectCandidate: (candidate: CandidateChannel) => Promise<void> }) {
  const [data, setData] = useState<GamesResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      let delay = 30_000;
      try {
        const response = await apiService.request<GamesResponse>('/games');
        if (cancelled) return;
        setData(response);
        if (response.matching?.running) delay = 2_000;
        setRequestError('');
        setSelectedId(current => [...response.games, ...(response.namedEvents || [])].some(event => event.id === current) ? current : null);
      } catch {
        if (!cancelled) setRequestError('Sports data is temporarily unavailable');
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, delay);
      }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [isActive]);

  const stale = Boolean(requestError) || Boolean(data?.freshness.stale);
  const error = requestError || data?.freshness.error;
  const enabledLeagues: string[] = data?.settings?.enabledLeagues || ['NFL', 'CFB'];
  const visibleGames = data?.games.filter(game => enabledLeagues.includes(game.league)) || [];
  const visibleEvents = (data?.namedEvents || []).filter(event => enabledLeagues.includes(event.league));
  const items = [
    ...visibleGames.map(game => ({ ...game, kind: 'game' as const })),
    ...visibleEvents.map(event => ({ ...event, logo: eventLogos[event.logo] || event.logo, kind: 'named' as const })),
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-container p-3">
      {groups.map(group => {
        const games = items.filter(game => game.group === group.id).sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === 'named' ? -1 : 1;
          return left.startsAt.localeCompare(right.startsAt);
        });
        const compact = group.id === 'startingSoon';
        if (!games.length) return null;
        return <section key={group.id} className="mb-5" aria-label={group.label}>
          <h3 className="mb-2 px-1 text-xs font-semibold tracking-wide text-[#91A0AF]">{group.label}</h3>
          <div className="space-y-2">
            {games.map(game => game.kind === 'named'
              ? <NamedEventCard key={game.id} event={game} matchingError={data?.matching?.lastError} selected={selectedId === game.id} onToggle={() => setSelectedId(current => current === game.id ? null : game.id)} canSelect={canSelect} onSelectCandidate={onSelectCandidate} />
              : <article key={game.id} className={`overflow-hidden rounded-lg border ${selectedId === game.id ? 'border-[#4EA1FF]/60 bg-[#142331]' : 'border-[#233242] bg-[#101B26]'}`}>
              <button type="button" aria-label={game.teams.map(team => `${team.name}${team.score != null ? ` ${team.score}` : ''}`).join(' vs ')} aria-expanded={selectedId === game.id} aria-controls={`game-${game.id}`} onClick={() => setSelectedId(current => current === game.id ? null : game.id)} className={`group w-full text-left transition-colors hover:bg-[#182838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF] ${compact ? 'p-2.5' : 'p-3'}`}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[#91A0AF]">
                  <span>{game.league}{compact && (game.stale || stale) && <span className="ml-2 text-[#D7A94B]">Stale</span>}</span>
                  <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(game.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    <ChevronDown className={`ml-1 h-3.5 w-3.5 shrink-0 ${selectedId === game.id ? 'rotate-180' : ''}`} />
                  </span>
                </div>
                <div className={compact ? 'relative grid grid-cols-2 gap-x-4' : 'space-y-2.5 py-1'}>
                  {compact && <span aria-hidden="true" className="absolute left-1/2 top-0 flex h-9 -translate-x-1/2 items-center text-xs font-medium text-[#91A0AF]">vs</span>}
                  {game.teams.map((team, index) => <div key={team.id} className={`flex min-w-0 ${compact ? `flex-col gap-1 ${index === 0 ? 'items-start text-left' : 'items-end text-right'}` : 'items-center gap-3'}`}>
                    <TeamLogo key={`${team.darkLogo || ''}:${team.logo || ''}`} team={team} />
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-5 text-[#E6EDF3]">{compact ? team.location || team.shortName || team.name : team.name}</span>
                    {!compact && team.score != null && <span className="shrink-0 text-xl font-bold tabular-nums leading-none text-[#E6EDF3]">{team.score}</span>}
                  </div>)}
                </div>
                {!compact && <div className="mt-3 flex items-center justify-center gap-2 border-t border-[#233242] pt-2.5 text-center">
                  <span className={`flex items-center gap-1.5 text-xs ${game.stale || stale ? 'text-[#D7A94B]' : game.group === 'live' ? 'text-[#E6EDF3]' : 'text-[#91A0AF]'}`}>
                    {statusLabel({ ...game, stale: game.stale || stale })}{game.stale && game.status !== 'live' ? ' · stale' : ''}
                  </span>
                </div>}
              </button>
              {selectedId === game.id && <div id={`game-${game.id}`} className="border-t border-[#233242] px-3 py-4 text-sm text-[#91A0AF]">
                <GameCandidates key={game.id} gameId={game.id} matchingVersion={`${game.matching.matchedAt || ''}:${data?.matching?.lastError || ''}`} storedResult={game.matching.candidates ? game.matching : undefined} canSelect={canSelect} onSelect={onSelectCandidate} />
              </div>}
            </article>)}
          </div>
        </section>;
      })}
      {(!data || error || items.length === 0) && <p role="status" className={`px-1 text-xs leading-5 ${error ? 'text-[#D7A94B]' : 'text-[#91A0AF]'}`}>
        {error ? `${error}. ${visibleGames.length ? 'Showing retained games.' : visibleEvents.length ? 'Scheduled events are available.' : 'Try again shortly; Channels and Chat are available.'}`
          : !data ? 'Loading games…'
          : 'No games in the current window. Upcoming games appear six hours before kickoff.'}
      </p>}
    </div>
  );
}
