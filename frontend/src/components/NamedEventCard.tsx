import { useState } from 'react';
import { ChevronDown, Clock3 } from 'lucide-react';
import GameCandidates from './GameCandidates';
import { CandidateChannel, GameMatching } from './gameMatchingTypes';

export interface NamedEvent {
  id: string;
  name: string;
  league: string;
  logo: string;
  matching: GameMatching & { count?: number };
  startsAt: string;
  endsAt: string;
  group: 'live' | 'startingSoon';
}

export default function NamedEventCard({ event, matchingError, selected, onToggle, canSelect, onSelectCandidate }: {
  event: NamedEvent;
  matchingError?: string | null;
  selected: boolean;
  onToggle: () => void;
  canSelect: boolean;
  onSelectCandidate: (candidate: CandidateChannel) => Promise<void>;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return <article className={`overflow-hidden rounded-lg border ${selected ? 'border-[#4EA1FF]/60 bg-[#142331]' : 'border-[#233242] bg-[#101B26]'}`}>
    <button type="button" aria-label={event.name} aria-expanded={selected} aria-controls={`event-${event.id}`} onClick={onToggle} className="w-full p-3 text-left transition-colors hover:bg-[#182838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF]">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-[#91A0AF]">
        <span>{event.league}</span>
        <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{time(event.startsAt)}
          <ChevronDown className={`ml-1 h-3.5 w-3.5 shrink-0 ${selected ? 'rotate-180' : ''}`} />
        </span>
      </div>
      <div className="flex items-center gap-3">
        {!logoFailed && <img src={event.logo} alt="" className="h-9 w-9 shrink-0 object-contain" onError={() => setLogoFailed(true)} />}
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-[#E6EDF3]">{event.name}</div>
        </div>
      </div>
    </button>
    {selected && <div id={`event-${event.id}`} className="border-t border-[#233242] px-3 py-4 text-sm text-[#91A0AF]">
      <GameCandidates gameId={event.id} matchingVersion={`${event.matching.matchedAt || ''}:${matchingError || ''}`} storedResult={event.matching.candidates ? event.matching : undefined} canSelect={canSelect} onSelect={onSelectCandidate} />
    </div>}
  </article>;
}
