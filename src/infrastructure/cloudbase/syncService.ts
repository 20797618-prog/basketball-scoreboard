import { getRdb, ensureLogin, getOrCreateSyncCode, setSyncCode } from './client';
import { appDb } from '../db/appDb';
import type {
  Athlete,
  ColaLedgerEntry,
  Match,
  MatchPlayer,
  Round,
  RoundStat,
} from '../../domain/types';
import type { Table } from 'dexie';

/**
 * 同步服务：负责本地 IndexedDB（Dexie）与 CloudBase 关系型数据库（PostgreSQL）之间的双向同步。
 *
 * 方案：恢复码（sync_code）隔离。
 * - 备份（push）：用一个 6 位「恢复码」标识数据归属，把本地全部数据连同恢复码 upsert 到云端；
 * - 恢复（pull）：输入恢复码，按 sync_code 查询云端数据，覆盖式合并到本地。
 *
 * 这样即使清缓存 / 换设备（匿名身份变化），只要记得恢复码就能找回数据。
 * 数据归属不再依赖匿名 uid（匿名身份清缓存后会变）。
 */

// 各业务表名（数据库表名）
const TABLES = {
  athletes: 'athletes',
  matches: 'matches',
  matchPlayers: 'match_players',
  rounds: 'rounds',
  roundStats: 'round_stats',
  colaLedger: 'cola_ledger',
} as const;

export type SyncDirection = 'push' | 'pull';

export interface SyncResult {
  direction: SyncDirection;
  syncCode: string;
  counts: {
    athletes: number;
    matches: number;
    matchPlayers: number;
    rounds: number;
    roundStats: number;
    colaLedger: number;
  };
  startedAt: number;
  finishedAt: number;
}

// ============ 字段映射：camelCase <-> snake_case ============
// 所有行都带 sync_code 字段

const athleteToRow = (a: Athlete, syncCode: string) => ({
  id: a.id,
  name: a.name,
  is_deleted: a.isDeleted,
  created_at: a.createdAt,
  updated_at: a.updatedAt,
  sync_code: syncCode,
});

const matchToRow = (m: Match, syncCode: string) => ({
  id: m.id,
  title: m.title,
  status: m.status,
  created_at: m.createdAt,
  finished_at: m.finishedAt,
  sync_code: syncCode,
});

const matchPlayerToRow = (mp: MatchPlayer, syncCode: string) => ({
  id: mp.id,
  match_id: mp.matchId,
  athlete_id: mp.athleteId,
  join_order: mp.joinOrder,
  sync_code: syncCode,
});

const roundToRow = (r: Round, syncCode: string) => ({
  id: r.id,
  match_id: r.matchId,
  round_no: r.roundNo,
  phase: r.phase,
  overtime_seq: r.overtimeSeq,
  parent_round_id: r.parentRoundId,
  created_at: r.createdAt,
  sync_code: syncCode,
});

const roundStatToRow = (rs: RoundStat, syncCode: string) => ({
  id: rs.id,
  round_id: rs.roundId,
  match_id: rs.matchId,
  athlete_id: rs.athleteId,
  attempts: rs.attempts,
  hits: rs.hits,
  hit_rate: rs.hitRate,
  rank_group: rs.rankGroup,
  point_delta: rs.pointDelta,
  cola_delta: rs.colaDelta,
  created_at: rs.createdAt,
  sync_code: syncCode,
});

const colaLedgerToRow = (c: ColaLedgerEntry, syncCode: string) => ({
  id: c.id,
  type: c.type,
  from_athlete_id: c.fromAthleteId,
  to_athlete_id: c.toAthleteId,
  amount: c.amount,
  match_id: c.matchId,
  round_id: c.roundId,
  note: c.note,
  created_at: c.createdAt,
  operator: c.operator,
  sync_code: syncCode,
});

const rowToAthlete = (r: any): Athlete => ({
  id: r.id,
  name: r.name,
  isDeleted: r.is_deleted,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const rowToMatch = (r: any): Match => ({
  id: r.id,
  title: r.title,
  status: r.status,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

const rowToMatchPlayer = (r: any): MatchPlayer => ({
  id: r.id,
  matchId: r.match_id,
  athleteId: r.athlete_id,
  joinOrder: r.join_order,
});

const rowToRound = (r: any): Round => ({
  id: r.id,
  matchId: r.match_id,
  roundNo: r.round_no,
  phase: r.phase,
  overtimeSeq: r.overtime_seq,
  parentRoundId: r.parent_round_id,
  createdAt: r.created_at,
});

const rowToRoundStat = (r: any): RoundStat => ({
  id: r.id,
  roundId: r.round_id,
  matchId: r.match_id,
  athleteId: r.athlete_id,
  attempts: r.attempts,
  hits: r.hits,
  hitRate: r.hit_rate,
  rankGroup: r.rank_group,
  pointDelta: r.point_delta,
  colaDelta: r.cola_delta,
  createdAt: r.created_at,
});

const rowToColaLedger = (r: any): ColaLedgerEntry => ({
  id: r.id,
  type: r.type,
  fromAthleteId: r.from_athlete_id,
  toAthleteId: r.to_athlete_id,
  amount: r.amount,
  matchId: r.match_id,
  roundId: r.round_id,
  note: r.note,
  createdAt: r.created_at,
  operator: r.operator,
});

// ============ 通用 upsert / fetch ============

/** 把一批行 upsert 到云端表（幂等，按主键 id 冲突时覆盖）。 */
async function upsertRows(
  tableName: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  const rdb = getRdb();

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await rdb.from(tableName).upsert(chunk);
    if (error) {
      console.warn(`[sync] upsert ${tableName} 失败`, error);
      throw new Error(`云端写入 ${tableName} 失败：${error.message ?? error}`);
    }
  }
}

/** 按恢复码拉取某张表的全部行。 */
async function fetchBySyncCode(
  tableName: string,
  syncCode: string,
): Promise<any[]> {
  const rdb = getRdb();
  const { data, error } = await rdb
    .from(tableName)
    .select('*')
    .eq('sync_code', syncCode)
    .limit(1000);
  if (error) {
    console.warn(`[sync] fetch ${tableName} 失败`, error);
    throw new Error(`云端读取 ${tableName} 失败：${error.message ?? error}`);
  }
  return (data ?? []) as any[];
}

/** 清空本地某张表并批量写入（用于拉取时的覆盖合并）。 */
async function replaceLocalTable<T>(
  table: Table<T, string>,
  rows: T[],
): Promise<void> {
  await table.clear();
  if (rows.length > 0) {
    await table.bulkAdd(rows);
  }
}

// ============ 备份到云端 ============

export async function pushToCloud(customCode?: string): Promise<SyncResult> {
  const startedAt = Date.now();
  await ensureLogin();
  // 用户自定义了恢复码则使用，并持久化；否则用默认/已缓存的码
  const normalized = (customCode ?? '').trim().toUpperCase();
  const syncCode = normalized || getOrCreateSyncCode();
  if (normalized) {
    setSyncCode(normalized);
  }

  const [
    athletes,
    matches,
    matchPlayers,
    rounds,
    roundStats,
    colaLedger,
  ] = await Promise.all([
    appDb.athletes.toArray(),
    appDb.matches.toArray(),
    appDb.matchPlayers.toArray(),
    appDb.rounds.toArray(),
    appDb.roundStats.toArray(),
    appDb.colaLedger.toArray(),
  ]);

  await upsertRows(TABLES.athletes, athletes.map((a) => athleteToRow(a, syncCode)));
  await upsertRows(TABLES.matches, matches.map((m) => matchToRow(m, syncCode)));
  await upsertRows(TABLES.matchPlayers, matchPlayers.map((mp) => matchPlayerToRow(mp, syncCode)));
  await upsertRows(TABLES.rounds, rounds.map((r) => roundToRow(r, syncCode)));
  await upsertRows(TABLES.roundStats, roundStats.map((rs) => roundStatToRow(rs, syncCode)));
  await upsertRows(TABLES.colaLedger, colaLedger.map((c) => colaLedgerToRow(c, syncCode)));

  return {
    direction: 'push',
    syncCode,
    counts: {
      athletes: athletes.length,
      matches: matches.length,
      matchPlayers: matchPlayers.length,
      rounds: rounds.length,
      roundStats: roundStats.length,
      colaLedger: colaLedger.length,
    },
    startedAt,
    finishedAt: Date.now(),
  };
}

// ============ 从云端恢复 ============

export async function pullFromCloud(syncCode: string): Promise<SyncResult> {
  const startedAt = Date.now();
  await ensureLogin();
  const code = syncCode.trim().toUpperCase();
  if (!code) {
    throw new Error('请输入恢复码');
  }

  const [athletes, matches, matchPlayers, rounds, roundStats, colaLedger] =
    await Promise.all([
      fetchBySyncCode(TABLES.athletes, code),
      fetchBySyncCode(TABLES.matches, code),
      fetchBySyncCode(TABLES.matchPlayers, code),
      fetchBySyncCode(TABLES.rounds, code),
      fetchBySyncCode(TABLES.roundStats, code),
      fetchBySyncCode(TABLES.colaLedger, code),
    ]);

  // 检查是否真的拉到了数据（避免用户输入错误恢复码后本地被清空）
  const totalFetched =
    athletes.length +
    matches.length +
    matchPlayers.length +
    rounds.length +
    roundStats.length +
    colaLedger.length;
  if (totalFetched === 0) {
    throw new Error('未找到该恢复码对应的数据，请检查恢复码是否正确');
  }

  await appDb.transaction(
    'rw',
    [
      appDb.athletes,
      appDb.matches,
      appDb.matchPlayers,
      appDb.rounds,
      appDb.roundStats,
      appDb.colaLedger,
    ],
    async () => {
      await replaceLocalTable(appDb.athletes, athletes.map(rowToAthlete));
      await replaceLocalTable(appDb.matches, matches.map(rowToMatch));
      await replaceLocalTable(appDb.matchPlayers, matchPlayers.map(rowToMatchPlayer));
      await replaceLocalTable(appDb.rounds, rounds.map(rowToRound));
      await replaceLocalTable(appDb.roundStats, roundStats.map(rowToRoundStat));
      await replaceLocalTable(appDb.colaLedger, colaLedger.map(rowToColaLedger));
    },
  );

  return {
    direction: 'pull',
    syncCode: code,
    counts: {
      athletes: athletes.length,
      matches: matches.length,
      matchPlayers: matchPlayers.length,
      rounds: rounds.length,
      roundStats: roundStats.length,
      colaLedger: colaLedger.length,
    },
    startedAt,
    finishedAt: Date.now(),
  };
}
