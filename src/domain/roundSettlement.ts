import { rankRoundByRules, type RankingInput, type RankingOutput } from './ranking';
import type { RankGroup } from './types';

export type SettlementMode =
  | 'regular'
  | 'overtime_loser'
  | 'overtime_winner'
  | 'overtime_duel';

export interface SettlementRow extends RankingInput {
  hitRate: number;
  rank: number;
  rankGroup: RankGroup;
  pointDelta: -1 | 0 | 1;
  colaDelta: -1 | 0 | 1;
}

export interface SettlementResult {
  rows: SettlementRow[];
  needLoserOvertime: boolean;
  needWinnerOvertime: boolean;
  loserAthleteIds: string[];
  winnerAthleteIds: string[];
  /** 2 人局两人打平时，合并为一场「duel」加时（赢+1/输-1 同轮结算） */
  needDuelOvertime: boolean;
  duelAthleteIds: string[];
}

export interface SettleOptions {
  /**
   * 是否允许在本轮结算输家。默认 true。
   * 若本轮赢家尚未确定（最高分并列、赢家要另行加时），
   * 调用方应传 false，把输家的 −1 也一起押后，避免只扣不加。
   */
  chargeLoser?: boolean;
}

export function settleRound(
  items: RankingInput[],
  mode: SettlementMode = 'regular',
  opts: SettleOptions = {},
): SettlementResult {
  const ranked = rankRoundByRules(items);

  if (mode === 'overtime_duel') {
    return settleDuel(ranked);
  }

  const topRank = ranked[0]?.rank ?? 1;
  const bottomRank = ranked[ranked.length - 1]?.rank ?? 1;

  const winnerRows = ranked.filter((r) => r.rank === topRank);
  const loserRows = ranked.filter((r) => r.rank === bottomRank);
  const canAward = ranked.length > 1;

  const shouldAwardWinner =
    mode !== 'overtime_loser' && canAward && winnerRows.length === 1;

  // 关键：一轮只能在「赢家已确定」时才扣输家。
  // 否则会出现「最高分并列（赢家待定）+ 最低分唯一」的情形：
  // 输家先被扣了 -1，赢家的 +1 却要等加时决出——若加时一直平/中途结束，
  // 这 -1 就永远没有对手方，可乐凭空蒸发。
  // overtime_loser 模式下赢家已在上一轮结算过，因此照常扣输家。
  const winnerAlreadySettled = mode === 'overtime_loser' || winnerRows.length === 1;

  const shouldAwardLoser =
    mode !== 'overtime_winner' &&
    canAward &&
    loserRows.length === 1 &&
    winnerAlreadySettled &&
    opts.chargeLoser !== false;

  const rows: SettlementRow[] = ranked.map((row) => {
    const isWinner = row.rank === topRank;
    const isLoser = row.rank === bottomRank;

    let rankGroup: RankGroup = 'middle';
    let pointDelta: -1 | 0 | 1 = 0;
    let colaDelta: -1 | 0 | 1 = 0;

    if (isWinner) {
      rankGroup = 'winner';
      if (shouldAwardWinner) {
        pointDelta = 1;
        colaDelta = 1;
      }
    }

    if (isLoser) {
      rankGroup = 'loser';
      if (shouldAwardLoser) {
        pointDelta = -1;
        colaDelta = -1;
      }
    }

    if (isWinner && isLoser) {
      rankGroup = 'middle';
      pointDelta = 0;
      colaDelta = 0;
    }

    return {
      ...row,
      rankGroup,
      pointDelta,
      colaDelta,
    };
  });

  const needLoserOvertime =
    mode !== 'overtime_winner' && canAward && loserRows.length > 1;
  const needWinnerOvertime =
    mode !== 'overtime_loser' && canAward && winnerRows.length > 1;

  // 2 人局且两人命中打平：合并为一场 duel 加时，不再拆成「最后加时 + 第一加时」两次。
  const isTwoPersonTie =
    mode === 'regular' && ranked.length === 2 && winnerRows.length === 2;

  return {
    rows,
    needLoserOvertime: isTwoPersonTie ? false : needLoserOvertime,
    needWinnerOvertime: isTwoPersonTie ? false : needWinnerOvertime,
    loserAthleteIds: loserRows.map((x) => x.athleteId),
    winnerAthleteIds: winnerRows.map((x) => x.athleteId),
    needDuelOvertime: isTwoPersonTie,
    duelAthleteIds: isTwoPersonTie ? winnerRows.map((x) => x.athleteId) : [],
  };
}

/**
 * 2 人合并加时（duel）：每人 1 球。
 * - 命中数不同：命中多者赢（积分/可乐 +1），另一人输（-1），同轮同时结算；
 * - 命中数相同：本轮不结算，继续下一球，直到分出胜负。
 */
function settleDuel(ranked: RankingOutput[]): SettlementResult {
  // 边界：duel 只剩 1 人（例如中途有人退出）。此时不能既判赢又判输（会只加不减），
  // 直接按未决处理，不结算任何一方。
  if (ranked.length < 2) {
    return {
      rows: ranked.map((row) => ({
        ...row,
        rankGroup: 'pending' as RankGroup,
        pointDelta: 0 as const,
        colaDelta: 0 as const,
      })),
      needLoserOvertime: false,
      needWinnerOvertime: false,
      loserAthleteIds: [],
      winnerAthleteIds: [],
      needDuelOvertime: false,
      duelAthleteIds: [],
    };
  }

  const tied = ranked[0].hits === ranked[1].hits;

  const rows: SettlementRow[] = ranked.map((row, index) => {
    const isWinner = !tied && index === 0;
    const isLoser = !tied && index === ranked.length - 1;
    return {
      ...row,
      rankGroup: (isWinner ? 'winner' : isLoser ? 'loser' : 'pending') as RankGroup,
      pointDelta: (isWinner ? 1 : isLoser ? -1 : 0) as -1 | 0 | 1,
      colaDelta: (isWinner ? 1 : isLoser ? -1 : 0) as -1 | 0 | 1,
    };
  });

  const ids = ranked.map((r) => r.athleteId);
  const lastIdx = ranked.length - 1;

  return {
    rows,
    needLoserOvertime: false,
    needWinnerOvertime: false,
    loserAthleteIds: tied ? [] : [ranked[lastIdx].athleteId],
    winnerAthleteIds: tied ? [] : [ranked[0].athleteId],
    needDuelOvertime: tied,
    duelAthleteIds: ids,
  };
}
