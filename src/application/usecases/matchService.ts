import {
  settleRound,
  type SettlementMode,
  type SettlementResult,
} from '../../domain/roundSettlement';
import type { RankingInput } from '../../domain/ranking';
import type { ColaLedgerEntry, Round, RoundPhase, RoundStat } from '../../domain/types';
import { createId } from '../../shared/createId';

export function previewRoundSettlement(
  inputs: RankingInput[],
  mode: SettlementMode = 'regular',
) {
  return settleRound(inputs, mode);
}

export function toRoundPhase(mode: SettlementMode): RoundPhase {
  if (mode === 'overtime_loser') return 'overtime_loser';
  if (mode === 'overtime_winner') return 'overtime_winner';
  if (mode === 'overtime_duel') return 'overtime_duel';
  return 'regular';
}

export function buildRound(params: {
  matchId: string;
  roundNo: number;
  mode: SettlementMode;
  parentRoundId: string | null;
  overtimeSeq: number;
}): Round {
  return {
    id: createId(),
    matchId: params.matchId,
    roundNo: params.roundNo,
    phase: toRoundPhase(params.mode),
    overtimeSeq: params.overtimeSeq,
    parentRoundId: params.parentRoundId,
    createdAt: Date.now(),
  };
}

export function buildRoundStats(params: {
  matchId: string;
  roundId: string;
  settlement: SettlementResult;
}): RoundStat[] {
  const now = Date.now();
  return params.settlement.rows.map((row) => ({
    id: createId(),
    roundId: params.roundId,
    matchId: params.matchId,
    athleteId: row.athleteId,
    attempts: row.attempts,
    hits: row.hits,
    hitRate: row.hitRate,
    rankGroup: row.rankGroup,
    pointDelta: row.pointDelta,
    colaDelta: row.colaDelta,
    createdAt: now,
  }));
}

export function buildRoundRewardLedger(params: {
  matchId: string;
  roundId: string;
  settlement: SettlementResult;
}): ColaLedgerEntry[] {
  const now = Date.now();
  return params.settlement.rows
    .filter((row) => row.colaDelta !== 0)
    .map((row) => {
      if (row.colaDelta > 0) {
        return {
          id: createId(),
          type: 'round_reward' as const,
          fromAthleteId: null,
          toAthleteId: row.athleteId,
          amount: row.colaDelta,
          matchId: params.matchId,
          roundId: params.roundId,
          note: '比赛奖励',
          createdAt: now,
          operator: 'system' as const,
        };
      }

      return {
        id: createId(),
        type: 'round_reward' as const,
        fromAthleteId: row.athleteId,
        toAthleteId: null,
        amount: Math.abs(row.colaDelta),
        matchId: params.matchId,
        roundId: params.roundId,
        note: '比赛扣减',
        createdAt: now,
        operator: 'system' as const,
      };
    });
}
