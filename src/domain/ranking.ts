export interface RankingInput {
  athleteId: string;
  attempts: number;
  hits: number;
}

export interface RankingOutput extends RankingInput {
  hitRate: number;
  rank: number;
}

export function rankRoundByRules(items: RankingInput[]): RankingOutput[] {
  const rows = items.map((item) => ({
    ...item,
    hitRate: item.attempts === 0 ? 0 : item.hits / item.attempts,
    rank: 0,
  }));

  rows.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return a.athleteId.localeCompare(b.athleteId);
  });

  let currentRank = 1;
  rows.forEach((row, index) => {
    if (index === 0) {
      row.rank = 1;
      return;
    }
    const prev = rows[index - 1];
    const isTie = prev.hits === row.hits;
    if (!isTie) currentRank = index + 1;
    row.rank = currentRank;
  });

  return rows;
}
