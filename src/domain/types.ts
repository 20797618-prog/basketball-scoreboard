export type EntityId = string;

export type RoundPhase =
  | 'regular'
  | 'overtime_loser'
  | 'overtime_winner'
  | 'overtime_duel';

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

/**
 * 球员认领：把「球员」和「登录账号」绑定起来。
 * - claimCode 由系统生成，球员本人凭码认领；
 * - claimedBy 为空表示尚未被任何人认领。
 */
export interface AthleteClaim {
  athleteId: EntityId;
  claimCode: string;
  claimedBy: string | null;
  claimedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 转让状态：pending 待对方确认 → approved 已入账 / rejected 被拒绝 / canceled 发起人撤销 */
export type ColaTransferStatus = 'pending' | 'approved' | 'rejected' | 'canceled';

/**
 * 可乐转让申请：A 发起 → B 确认后才写入 cola_ledger（正式账本）。
 * 只有正式账本参与余额计算，因此未确认的申请不影响任何人的可乐数。
 */
export interface ColaTransfer {
  id: EntityId;
  fromAthleteId: EntityId;
  toAthleteId: EntityId;
  amount: number;
  note: string | null;
  status: ColaTransferStatus;
  createdByEmail: string;
  decidedByEmail: string | null;
  createdAt: number;
  decidedAt: number | null;
}
