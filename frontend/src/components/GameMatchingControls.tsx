import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import apiService from '../services/ApiService';
import { MatchingStatus } from './gameMatchingTypes';

export default function GameMatchingControls({ matching, isAdmin, onRun }: { matching?: MatchingStatus; isAdmin: boolean; onRun: () => void }) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const run = async () => {
    setRequesting(true);
    setError('');
    try {
      await apiService.request('/admin/games/matching', 'POST');
      onRun();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start channel matching');
    } finally {
      setRequesting(false);
    }
  };
  const cancel = async () => {
    setCancelling(true);
    setError('');
    try {
      await apiService.request('/admin/games/matching/cancel', 'POST');
      onRun();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not cancel matching'); }
    finally { setCancelling(false); }
  };
  const running = requesting || matching?.running;
  const progress = matching?.progress;
  const phases: Record<string, string> = { sports: 'Refreshing games', catalog: 'Loading channel catalog', guide: 'Downloading and reading bulk guide', 'guide-cache': 'Using cached guide', ranking: 'Ranking candidate feeds', complete: 'Matching complete', failed: 'Matching failed', cancelled: 'Matching cancelled', cancelling: 'Cancelling matching' };
  return <div className="mb-4 space-y-2 px-1 text-xs leading-5 text-[#91A0AF]">
    {isAdmin && <button type="button" onClick={() => { void run(); }} disabled={running} className="admin-secondary flex items-center gap-2 rounded-md border border-[#33485C] px-3 py-2 text-[#B8D8FA] disabled:opacity-60">
      <RefreshCw className={`h-3 w-3 ${running ? 'animate-spin' : ''}`} />{running ? 'Matching channels…' : 'Run matching now'}
    </button>}
    {isAdmin && matching?.running && <button type="button" onClick={() => { void cancel(); }} disabled={cancelling || progress?.phase === 'cancelling'} className="admin-secondary rounded-md border border-[#33485C] px-3 py-2 text-[#B8D8FA] disabled:opacity-60">{cancelling || progress?.phase === 'cancelling' ? 'Cancelling…' : 'Cancel matching'}</button>}
    {progress && <div aria-live="polite" className="space-y-1">
      <p>{phases[progress.phase] || 'Matching'} · {Math.floor(progress.elapsedMs / 1000)}s elapsed</p>
      <p>Provider requests: {progress.requestsUsed}/{progress.requestBudget}</p>
      {progress.decodedBytes > 0 && <p>Guide data: {(progress.decodedBytes / 1048576).toFixed(1)} MiB decoded · {progress.programmesParsed.toLocaleString('en-US')} programmes parsed · {progress.programmesKept.toLocaleString('en-US')} retained</p>}
    </div>}
    {matching?.running && !isAdmin && <p>Channel matching is running…</p>}
    {matching?.lastSuccessfulAt && <p>Last successful matching: {new Date(matching.lastSuccessfulAt).toLocaleString()}</p>}
    {(error || matching?.lastError) && <p role="status" className="text-[#D7A94B]">{error || matching?.lastError}</p>}
  </div>;
}
