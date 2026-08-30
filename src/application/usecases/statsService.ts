import type { ColaLedgerEntry, Match, Round, RoundStat } from '../../domain/types';

export interface StatsFilters {
  matchId: string;
  athleteId: string;
  day: string;
}

export interface RankingRow {
  athleteId: string;
  value: number;
  wins?: number;
  rounds?: number;
}

const ALL_VALUE = '__all__';

export function allFilterValue() {
  return ALL_VALUE;
}

function inSelectedDay(ts: number, day: string): boolean {
  if (!day || day === ALL_VALUE) return true;

  const monthOnlyMatch = day.trim().match(/^([1-9]|1[0-2])$/);
  if (monthOnlyMatch) {
    const selectedMonth = Number(monthOnlyMatch[1]);
    return new Date(ts).getMonth() + 1 === selectedMonth;
  }

  const yearMonthMatch = day.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (yearMonthMatch) {
    const y = Number(yearMonthMatch[1]);
    const m = Number(yearMonthMatch[2]);
    const date = new Date(ts);
    return date.getFullYear() === y && date.getMonth() + 1 === m;
  }

  const normalized = day.trim().replace(/\./g, '-').replace(/\//g, '-');
  const [yRaw, mRaw, dRaw] = normalized.split('-');
  const y = Number(yRaw);
  const m = Number(mRaw);
  const d = Number(dRaw);

  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return true;
  }

  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return true;
  }

  return ts >= start && ts <= end;
}

export function filterRoundStats(
  stats: RoundStat[],
  filters: StatsFilters,
): RoundStat[] {
  return stats.filter((row) => {
    const passMatch =
      filters.matchId === ALL_VALUE || !filters.matchId || row.matchId === filters.matchId;
    const passAthlete =
      filters.athleteId === ALL_VALUE ||
      !filters.athleteId ||
      row.athleteId === filters.athleteId;
    const passDay = inSelectedDay(row.createdAt, filters.day);
    return passMatch && passAthlete && passDay;
  });
}

export function filterLedger(
  entries: ColaLedgerEntry[],
  filters: StatsFilters,
): ColaLedgerEntry[] {
  return entries.filter((row) => {
    const relatedToAthlete =
      filters.athleteId === ALL_VALUE ||
      !filters.athleteId ||
      row.fromAthleteId === filters.athleteId ||
      row.toAthleteId === filters.athleteId;

    const passMatch =
      filters.matchId === ALL_VALUE ||
      !filters.matchId ||
      row.matchId === filters.matchId;

    const passDay = inSelectedDay(row.createdAt, filters.day);
    return relatedToAthlete && passMatch && passDay;
  });
}

export function buildPointRanking(stats: RoundStat[]): RankingRow[] {
  const map = new Map<string, number>();
  stats.forEach((row) => {
    map.set(row.athleteId, (map.get(row.athleteId) ?? 0) + row.pointDelta);
  });

  return [...map.entries()]
    .map(([athleteId, value]) => ({ athleteId, value }))
    .sort((a, b) => b.value - a.value);
}

export function buildWinRateRanking(stats: RoundStat[]): RankingRow[] {
  const map = new Map<string, { wins: number; rounds: number }>();

  stats.forEach((row) => {
    const prev = map.get(row.athleteId) ?? { wins: 0, rounds: 0 };
    prev.rounds += 1;
    if (row.pointDelta > 0) prev.wins += 1;
    map.set(row.athleteId, prev);
  });

  return [...map.entries()]
    .map(([athleteId, value]) => ({
      athleteId,
      value: value.rounds === 0 ? 0 : value.wins / value.rounds,
      wins: value.wins,
      rounds: value.rounds,
    }))
    .sort((a, b) => b.value - a.value);
}

export function buildPointRankingFromRoundLedger(entries: ColaLedgerEntry[]): RankingRow[] {
  const map = new Map<string, number>();

  entries
    .filter((entry) => entry.type === 'round_reward')
    .forEach((entry) => {
      if (entry.toAthleteId) {
        map.set(entry.toAthleteId, (map.get(entry.toAthleteId) ?? 0) + entry.amount);
      }
      if (entry.fromAthleteId) {
        map.set(entry.fromAthleteId, (map.get(entry.fromAthleteId) ?? 0) - entry.amount);
      }
    });

  return [...map.entries()]
    .map(([athleteId, value]) => ({ athleteId, value }))
    .sort((a, b) => b.value - a.value);
}

export function buildWinRateRankingFromRoundLedger(entries: ColaLedgerEntry[]): RankingRow[] {
  const map = new Map<string, { wins: number; rounds: number }>();

  entries
    .filter((entry) => entry.type === 'round_reward')
    .forEach((entry) => {
      if (entry.toAthleteId) {
        const prev = map.get(entry.toAthleteId) ?? { wins: 0, rounds: 0 };
        prev.wins += 1;
        prev.rounds += 1;
        map.set(entry.toAthleteId, prev);
      }

      if (entry.fromAthleteId) {
        const prev = map.get(entry.fromAthleteId) ?? { wins: 0, rounds: 0 };
        prev.rounds += 1;
        map.set(entry.fromAthleteId, prev);
      }
    });

  return [...map.entries()]
    .map(([athleteId, value]) => ({
      athleteId,
      value: value.rounds === 0 ? 0 : value.wins / value.rounds,
      wins: value.wins,
      rounds: value.rounds,
    }))
    .sort((a, b) => b.value - a.value);
}

export function buildColaRanking(entries: ColaLedgerEntry[]): RankingRow[] {
  const map = new Map<string, number>();

  entries.forEach((entry) => {
    if (entry.fromAthleteId) {
      map.set(
        entry.fromAthleteId,
        (map.get(entry.fromAthleteId) ?? 0) - entry.amount,
      );
    }
    if (entry.toAthleteId) {
      map.set(
        entry.toAthleteId,
        (map.get(entry.toAthleteId) ?? 0) + entry.amount,
      );
    }
  });

  return [...map.entries()]
    .map(([athleteId, value]) => ({ athleteId, value }))
    .sort((a, b) => b.value - a.value);
}

export interface RoundDetailRow {
  key: string;
  athleteId: string;
  matchId: string;
  matchTitle: string;
  roundLabel: string;
  attempts: number;
  hits: number;
  hitRate: number;
  pointDelta: -1 | 0 | 1;
  colaDelta: -1 | 0 | 1;
  createdAt: number;
}

export function buildRoundDetails(params: {
  stats: RoundStat[];
  rounds: Round[];
  matches: Match[];
}): RoundDetailRow[] {
  const roundMap = new Map<string, Round>();
  params.rounds.forEach((row) => roundMap.set(row.id, row));

  const matchMap = new Map<string, Match>();
  params.matches.forEach((row) => matchMap.set(row.id, row));

  const toRoundLabel = (round: Round | undefined): string => {
    if (!round) return '未知轮次';
    if (round.phase === 'regular') return `第 ${round.roundNo} 轮`;
    if (round.phase === 'overtime_loser') {
      return `第 ${round.roundNo} 轮 · 最后加时 #${round.overtimeSeq}`;
    }
    return `第 ${round.roundNo} 轮 · 第一加时 #${round.overtimeSeq}`;
  };

  return params.stats
    .map((row) => {
      const round = roundMap.get(row.roundId);
      const match = matchMap.get(row.matchId);
      return {
        key: row.id,
        athleteId: row.athleteId,
        matchId: row.matchId,
        matchTitle: match?.title ?? row.matchId,
        roundLabel: toRoundLabel(round),
        attempts: row.attempts,
        hits: row.hits,
        hitRate: row.hitRate,
        pointDelta: row.pointDelta,
        colaDelta: row.colaDelta,
        createdAt: row.createdAt,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
