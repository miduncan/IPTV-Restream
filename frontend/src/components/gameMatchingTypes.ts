export interface MatchingStatus {
  running: boolean;
  lastSuccessfulAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  progress?: { phase: string; requestsUsed: number; requestBudget: number; decodedBytes: number; programmesParsed: number; programmesKept: number; elapsedMs: number };
  guideCoverage?: { limitations?: string[] };
}

export interface CandidateChannel {
  id: string;
  sourceId: string;
  categoryId?: string;
  category?: string;
  name: string;
  confidenceScore: number;
  scorer?: 'ppv' | 'streaming' | 'cable' | 'local';
  scores?: { ppv: number; streaming: number; cable: number; local: number };
  rawScores?: { ppv: number; streaming: number; cable: number; local: number };
  scoreMaximums?: { ppv: number; streaming: number; cable: number; local: number };
  evidence: { kind: string; description: string; teams?: { ambiguous: boolean }[] }[];
  epgInspection?: {
    status: 'available' | 'empty' | 'unmapped' | 'unavailable';
    window: { start: string; end: string };
    score: number;
    bonus: number;
    penalty: number;
    programmes: { title: string; description: string; categories: string[]; start: string; end: string; points: number; treatment: string }[];
  };
}

export interface GameMatching {
  gameId: string;
  state: 'pending' | 'complete';
  candidates: CandidateChannel[];
  matchedAt: string | null;
  guideSnapshot?: { fetchedAt: string | null; cached: boolean; stale: boolean } | null;
  stale: boolean;
  lastError: string | null;
}
