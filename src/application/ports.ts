import type {
  Athlete,
  ColaLedgerEntry,
  Match,
  MatchPlayer,
  Round,
  RoundStat,
} from '../domain/types';

export interface AthleteRepository {
  listActive(): Promise<Athlete[]>;
  listAll(): Promise<Athlete[]>;
  create(name: string): Promise<Athlete>;
  updateName(id: string, name: string): Promise<void>;
  softDelete(id: string): Promise<void>;
}

export interface MatchRepository {
  createMatch(match: Match, players: MatchPlayer[]): Promise<void>;
  getActiveMatch(): Promise<Match | null>;
  getPlayers(matchId: string): Promise<MatchPlayer[]>;
  finishMatch(matchId: string): Promise<void>;
  listAll(): Promise<Match[]>;
}

export interface RoundRepository {
  createRound(round: Round): Promise<void>;
  saveRoundStats(rows: RoundStat[]): Promise<void>;
  getRoundsByMatch(matchId: string): Promise<Round[]>;
  getRoundStatsByMatch(matchId: string): Promise<RoundStat[]>;
  listAllRounds(): Promise<Round[]>;
  listAllRoundStats(): Promise<RoundStat[]>;
  deleteRoundWithStats(roundId: string): Promise<void>;
}

export interface ColaLedgerRepository {
  append(entries: ColaLedgerEntry[]): Promise<void>;
  listAll(): Promise<ColaLedgerEntry[]>;
  deleteByRound(roundId: string): Promise<void>;
}
