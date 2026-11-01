interface GameLeagueFilterProps {
  enabledLeagues: string[];
  selectedLeagues: string[];
  onChange: (leagues: string[]) => void;
}

export default function GameLeagueFilter({ enabledLeagues, selectedLeagues, onChange }: GameLeagueFilterProps) {
  return <fieldset className="mb-4 flex flex-wrap items-center gap-3 px-1 text-xs text-[#B5C4D2]">
    <legend className="mb-2 text-[#91A0AF]">Your leagues</legend>
    {enabledLeagues.map(league => <label key={league} className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" aria-label={`Show ${league} games`} checked={selectedLeagues.includes(league)}
        onChange={event => onChange(event.target.checked ? [...selectedLeagues, league] : selectedLeagues.filter(item => item !== league))}
        className="accent-[#4EA1FF]" />{league}
    </label>)}
    {enabledLeagues.length === 0 && <span>No leagues are enabled by the administrator.</span>}
  </fieldset>;
}
