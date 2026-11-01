import { CandidateChannel, GameMatching } from './gameMatchingTypes';

function GuideTime({ value }: { value: string | null | undefined }) {
  if (!value) return <>Unavailable</>;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <>Unavailable</>;
  return <time dateTime={value}>{date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })}</time>;
}

const missingGuide = {
  empty: 'No overlapping guide listings for this game window.',
  unmapped: 'No usable EPG mapping for this channel.',
  unavailable: 'Guide unavailable during this matching run.',
};

export default function CandidateGuideInspection({ candidate, result }: { candidate: CandidateChannel; result: GameMatching }) {
  const inspection = candidate.epgInspection;
  const snapshot = result.guideSnapshot;
  return <details className="mt-2 break-words text-xs leading-5 text-[#91A0AF]">
    <summary className="cursor-pointer">EPG examined{inspection ? ` · ${inspection.programmes.length} listings` : ''}</summary>
    {!inspection ? <p className="mt-1">Inspection data unavailable for this stored result. Run matching again to capture the guide input.</p> : <div className="mt-2 space-y-2">
      <div>
        <p>Game window: <GuideTime value={inspection.window.start} /> – <GuideTime value={inspection.window.end} /></p>
        <p>Guide retrieved: <GuideTime value={snapshot?.fetchedAt} />{snapshot?.cached ? ' · cached' : ''}{snapshot?.stale ? ' · stale' : ''}</p>
        <p>Matching run: <GuideTime value={result.matchedAt} /></p>
      </div>
      <p>Strongest EPG signal: {inspection.score}/20 · Applied corroboration: +{inspection.bonus} · Applied conflict penalty: −{inspection.penalty}</p>
      {inspection.status !== 'available' && <p>{missingGuide[inspection.status]}</p>}
      {inspection.programmes.length > 0 && <>
        <p>Programme scores are alternatives, not added together.</p>
        <ul className="space-y-3 border-l border-[#33485C] pl-3">
          {inspection.programmes.map((programme, index) => <li key={`${programme.start}:${index}`}>
            <p className="font-medium text-[#B8D8FA]">{programme.title || 'Untitled programme'}</p>
            <p><GuideTime value={programme.start} /> – <GuideTime value={programme.end} /></p>
            {programme.description && <p className="whitespace-pre-wrap">{programme.description}</p>}
            {programme.categories.length > 0 && <p>Categories: {programme.categories.join(', ')}</p>}
            <p className="mt-1">{programme.treatment}</p>
          </li>)}
        </ul>
      </>}
    </div>}
  </details>;
}
