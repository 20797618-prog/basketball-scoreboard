import type {
  Athlete,
  AthleteClaim,
  ColaLedgerEntry,
  ColaTransfer,
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

export interface AthleteClaimRepository {
  /** 列出全部认领记录。 */
  listAll(): Promise<AthleteClaim[]>;
  /** 为缺少认领记录的球员补齐（生成认领码），返回最新全量。 */
  ensureForAthletes(athleteIds: string[]): Promise<AthleteClaim[]>;
  /** 凭认领码把球员绑定到 email；码不对时抛错。 */
  claimByCode(athleteId: string, code: string, email: string): Promise<void>;
  /** 解除绑定（仅限本人）。 */
  release(athleteId: string, email: string): Promise<void>;
}

export interface ColaTransferRepository {
  listAll(): Promise<ColaTransfer[]>;
  createMany(rows: ColaTransfer[]): Promise<void>;
  patch(id: string, patch: Partial<ColaTransfer>): Promise<void>;
}
