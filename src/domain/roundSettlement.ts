import { rankRoundByRules, type RankingInput } from './ranking';
import type { RankGroup } from './types';

export type SettlementMode = 'regular' | 'overtime_loser' | 'overtime_winner';

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
}

export function settleRound(
  items: RankingInput[],
  mode: SettlementMode = 'regular',
): SettlementResult {
  const ranked = rankRoundByRules(items);
  const topRank = ranked[0]?.rank ?? 1;
  const bottomRank = ranked[ranked.length - 1]?.rank ?? 1;

  const winnerRows = ranked.filter((r) => r.rank === topRank);
  const loserRows = ranked.filter((r) => r.rank === bottomRank);
  const canAward = ranked.length > 1;

  const shouldAwardWinner =
    mode !== 'overtime_loser' && canAward && winnerRows.length === 1;
  const shouldAwardLoser =
    mode !== 'overtime_winner' && canAward && loserRows.length === 1;

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

  return {
    rows,
    needLoserOvertime,
    needWinnerOvertime,
    loserAthleteIds: loserRows.map((x) => x.athleteId),
    winnerAthleteIds: winnerRows.map((x) => x.athleteId),
  };
}
