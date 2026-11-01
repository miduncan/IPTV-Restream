export interface DiscoveryCoverage {
  broadcastRegions?: Record<string, string>;
  limitations?: string[];
}

export default function GameCoverage({ guideLimitations = [] }: { guideLimitations?: string[] }) {
  if (!guideLimitations.length) return null;
  return <div className="mb-4 rounded-md border border-[#33485C] px-3 py-2 text-xs leading-5 text-[#91A0AF]">
    {guideLimitations.length > 0 && <>
      <p>Guide listings do not guarantee complete coverage for the next 48 hours.</p>
      <details className="mt-1"><summary className="cursor-pointer">Guide coverage details</summary><ul className="mt-1 space-y-1">{guideLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>
    </>}
  </div>;
}
