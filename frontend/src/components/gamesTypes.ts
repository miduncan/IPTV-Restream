export const GAME_LEAGUES = ['NFL', 'CFB'] as const;
export type GameLeague = typeof GAME_LEAGUES[number];
export interface GamesSettings {
  enabledLeagues: GameLeague[];
  estimatedDurationHours: Record<GameLeague, number>;
  broadcastRegions: string[];
  matchingEnabled: boolean;
  matchingTime: string;
  matchingTimezone: string;
}
