export type EntityId = string;

export type RoundPhase = 'regular' | 'overtime_loser' | 'overtime_winner';

export interface Athlete {
  id: EntityId;
  name: string;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Match {
  id: EntityId;
  title: string;
  status: 'active' | 'finished';
  createdAt: number;
  finishedAt: number | null;
}

export interface MatchPlayer {
  id: EntityId;
  matchId: EntityId;
  athleteId: EntityId;
  joinOrder: number;
}

export interface Round {
  id: EntityId;
  matchId: EntityId;
  roundNo: number;
  phase: RoundPhase;
  overtimeSeq: number;
  parentRoundId: EntityId | null;
  createdAt: number;
}

export type RankGroup = 'winner' | 'loser' | 'middle' | 'pending';

export interface RoundStat {
  id: EntityId;
  roundId: EntityId;
  matchId: EntityId;
  athleteId: EntityId;
  attempts: number;
  hits: number;
  hitRate: number;
  rankGroup: RankGroup;
  pointDelta: -1 | 0 | 1;
  colaDelta: -1 | 0 | 1;
  createdAt: number;
}

export type ColaLedgerType =
  | 'round_reward'
  | 'transfer'
  | 'consume'
  | 'adjust_reversal';

export interface ColaLedgerEntry {
  id: EntityId;
  type: ColaLedgerType;
  fromAthleteId: EntityId | null;
  toAthleteId: EntityId | null;
  amount: number;
  matchId: EntityId | null;
  roundId: EntityId | null;
  note: string | null;
  createdAt: number;
  operator: 'system' | 'user';
}
