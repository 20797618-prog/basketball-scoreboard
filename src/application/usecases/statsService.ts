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

export interface HitRateRow {
  athleteId: string;
  hits: number;
  attempts: number;
  rate: number;
}

export interface DailyHitRateRow {
  day: string;
  dayLabel: string;
  hits: number;
  attempts: number;
  rate: number;
  athleteCount: number;
}

/**
 * 轮次键：同一场比赛、同一轮号视为同一轮（同一轮多次加时合并成一轮）。
 * `roundKeyByRoundId` 把 roundId 映射到对应的轮次键。
 * 没传时退回到按 roundId 聚合（旧行为）。
 */
export type RoundKeyByRoundId = Map<string, string>;

function roundKeyFor(
  roundId: string,
  map: RoundKeyByRoundId | undefined,
): string {
  if (map && map.has(roundId)) return map.get(roundId)!;
  return roundId;
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

export function buildWinRateRanking(
  stats: RoundStat[],
  roundKeyByRoundId?: RoundKeyByRoundId,
): RankingRow[] {
  // 按 (athleteId, 轮次键) 聚合：同一轮同一运动员无论加时多少次都算一轮。
  // 最后 pointDelta > 0 则本轮算赢（加时先输后赢的情况）。
  const outcomes = new Map<string, 'win' | 'loss'>(); // key = athleteId|roundKey

  for (const row of stats) {
    const rk = roundKeyFor(row.roundId, roundKeyByRoundId);
    const key = `${row.athleteId}|${rk}`;
    if (row.pointDelta > 0) {
      outcomes.set(key, 'win');
    } else if (outcomes.get(key) !== 'win') {
      outcomes.set(key, 'loss');
    }
  }

  const summary = new Map<string, { wins: number; rounds: number }>();
  for (const [key, outcome] of outcomes) {
    const [athleteId] = key.split('|');
    const prev = summary.get(athleteId) ?? { wins: 0, rounds: 0 };
    prev.rounds += 1;
    if (outcome === 'win') prev.wins += 1;
    summary.set(athleteId, prev);
  }

  return [...summary.entries()]
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

export function buildWinRateRankingFromRoundLedger(
  entries: ColaLedgerEntry[],
  roundKeyByRoundId?: RoundKeyByRoundId,
): RankingRow[] {
  // 按 (athleteId, 轮次键) 聚合：同一轮同一运动员无论加时多少次都算一轮。
  // 若该轮次键中该运动员有"赢得奖励"的条目，则本轮算赢；只有扣减则算输。
  type RoundOutcome = 'win' | 'loss';
  const outcomes = new Map<string, RoundOutcome>(); // key = athleteId|roundKey

  for (const entry of entries) {
    if (entry.type !== 'round_reward') continue;
    if (entry.roundId == null) continue;
    const rk = roundKeyFor(entry.roundId, roundKeyByRoundId);
    if (entry.toAthleteId) {
      outcomes.set(`${entry.toAthleteId}|${rk}`, 'win');
    }
    if (entry.fromAthleteId) {
      const key = `${entry.fromAthleteId}|${rk}`;
      // 加时先输后赢的情况：以最后结果（赢）为准
      if (outcomes.get(key) !== 'win') outcomes.set(key, 'loss');
    }
  }

  const summary = new Map<string, { wins: number; rounds: number }>();
  for (const [key, outcome] of outcomes) {
    const [athleteId] = key.split('|');
    const prev = summary.get(athleteId) ?? { wins: 0, rounds: 0 };
    prev.rounds += 1;
    if (outcome === 'win') prev.wins += 1;
    summary.set(athleteId, prev);
  }

  return [...summary.entries()]
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

/**
 * 累计命中率排名：累计命中率 = 累计中球数 / 累计投篮数（含加时）。
 * 直接累加每位运动员所有 RoundStat 的 hits / attempts，不按轮次去重。
 */
export function buildHitRateRanking(stats: RoundStat[]): HitRateRow[] {
  const map = new Map<string, { hits: number; attempts: number }>();
  stats.forEach((row) => {
    const prev = map.get(row.athleteId) ?? { hits: 0, attempts: 0 };
    prev.hits += row.hits;
    prev.attempts += row.attempts;
    map.set(row.athleteId, prev);
  });

  return [...map.entries()]
    .map(([athleteId, v]) => ({
      athleteId,
      hits: v.hits,
      attempts: v.attempts,
      rate: v.attempts === 0 ? 0 : v.hits / v.attempts,
    }))
    .sort((a, b) => b.rate - a.rate);
}

/**
 * 每日命中率：按天聚合所有 RoundStat，每天一行。
 * 返回按日期升序排列（旧日期在前，方便折线图从左到右画趋势）。
 */
export function buildDailyHitRate(stats: RoundStat[]): DailyHitRateRow[] {
  const map = new Map<string, { hits: number; attempts: number; athletes: Set<string> }>();

  stats.forEach((row) => {
    const day = new Date(row.createdAt);
    const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
    const prev = map.get(key) ?? { hits: 0, attempts: 0, athletes: new Set<string>() };
    prev.hits += row.hits;
    prev.attempts += row.attempts;
    prev.athletes.add(row.athleteId);
    map.set(key, prev);
  });

  return [...map.entries()]
    .map(([day, v]) => {
      const [, m, d] = day.split('-').map(Number);
      return {
        day,
        dayLabel: `${m}月${d}日`,
        hits: v.hits,
        attempts: v.attempts,
        rate: v.attempts === 0 ? 0 : v.hits / v.attempts,
        athleteCount: v.athletes.size,
      };
    })
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
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
    if (round.phase === 'overtime_winner') {
      return `第 ${round.roundNo} 轮 · 第一加时 #${round.overtimeSeq}`;
    }
    if (round.phase === 'overtime_duel') {
      return `第 ${round.roundNo} 轮 · 加时 #${round.overtimeSeq}`;
    }
    return `第 ${round.roundNo} 轮`;
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
