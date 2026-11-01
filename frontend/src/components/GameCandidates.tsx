import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import apiService from '../services/ApiService';
import { CandidateChannel, GameMatching } from './gameMatchingTypes';
import CandidateGuideInspection from './CandidateGuideInspection';

export default function GameCandidates({ gameId, matchingVersion, canSelect, inspectionOnly = false, storedResult, onSelect }: { gameId: string; matchingVersion: string; canSelect: boolean; inspectionOnly?: boolean; storedResult?: GameMatching; onSelect?: (candidate: CandidateChannel) => Promise<void> }) {
  const [fetchedResult, setResult] = useState<GameMatching | null>(null);
  const result = storedResult || fetchedResult;
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visibleCandidates = showAll ? result?.candidates : result?.candidates.slice(0, 3);
  useEffect(() => {
    if (storedResult) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiService.request<GameMatching>(`/games/${encodeURIComponent(gameId)}/candidates`);
        if (!Array.isArray(response.candidates)) throw new Error('Invalid candidate response');
        if (!cancelled) { setResult(response); setError(''); }
      } catch {
        if (!cancelled) setError('Could not load candidate channels');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [gameId, matchingVersion, storedResult]);

  const select = async (candidate: CandidateChannel) => {
    if (!onSelect) return;
    setSelecting(candidate.sourceId);
    setError('');
    try {
      await onSelect(candidate);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start selected feed');
    } finally {
      setSelecting(null);
    }
  };

  return <div className="space-y-3">
    {error && <p role="alert" className="text-[#FF8A8A]">{error}</p>}
    {!result && !error && <p>Loading candidate channels…</p>}
    {result?.stale && <p className="text-[#D7A94B]">Stored candidates may be stale</p>}
    {result?.state === 'pending' && <p>Channel matching pending</p>}
    {result?.state === 'complete' && result.candidates.length === 0 && <p>No matching channels</p>}
    {result && result.candidates.length > 0 && <>
      {inspectionOnly && <p className="text-xs">Ranking score · not a probability</p>}
      {!canSelect && !inspectionOnly && <p>Admin access required to switch channels</p>}
      {visibleCandidates?.map(candidate => inspectionOnly ? <div key={candidate.id} className="rounded-md border border-[#33485C] p-3">
        <div className="flex items-start justify-between gap-3 text-[#DCE6EF]"><span>{candidate.name}<span className="mt-1 block text-xs text-[#91A0AF]">{candidate.category}</span></span><span className="shrink-0 text-[#8BC3FF]">{candidate.confidenceScore}/100</span></div>
        <details className="mt-2 text-xs leading-5 text-[#91A0AF]">
          <summary className="cursor-pointer">Why this feed</summary>
          <ul className="mt-1 space-y-1">{candidate.evidence.map((evidence, index) => <li key={index}>{evidence.description}{evidence.teams?.some(team => team.ambiguous) ? ' · ambiguous team name' : ''}</li>)}</ul>
        </details>
        <CandidateGuideInspection candidate={candidate} result={result} />
      </div> : <button key={candidate.id} type="button" aria-label={`Watch ${candidate.name}`} disabled={!canSelect || !onSelect || selecting !== null} onClick={() => { void select(candidate); }} className="block w-full rounded-md border border-[#33485C] p-3 text-left text-[#DCE6EF] hover:bg-[#182838] hover:text-[#8BC3FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4EA1FF] disabled:cursor-not-allowed disabled:opacity-60">
        {selecting === candidate.sourceId ? 'Switching…' : candidate.name}
      </button>)}
      {!showAll && result.candidates.length > 3 && <button type="button" onClick={() => setShowAll(true)} className="mx-auto flex items-center gap-1 text-sm text-[#8BC3FF] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4EA1FF]">
        Show all <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>}
    </>}
  </div>;
}
