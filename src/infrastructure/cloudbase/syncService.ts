import { SYNC_API_BASE, getOrCreateSyncCode, setSyncCode } from './client';
import { appDb } from '../db/appDb';
import type { Athlete, ColaLedgerEntry, Match, MatchPlayer, Round, RoundStat } from '../../domain/types';
import type { Table } from 'dexie';

/** 同步服务：通过 Cloudflare Worker + D1 完成备份与恢复。 */

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

interface SyncPayload {
  athletes: Athlete[];
  matches: Match[];
  matchPlayers: MatchPlayer[];
  rounds: Round[];
  roundStats: RoundStat[];
  colaLedger: ColaLedgerEntry[];
}

interface PullResponse {
  data: SyncPayload;
}

async function replaceLocalTable<T>(table: Table<T, string>, rows: T[]): Promise<void> {
  await table.clear();
  if (rows.length > 0) {
    await table.bulkAdd(rows);
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `请求失败（HTTP ${response.status}）`;
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {
    // ignore
  }
  throw new Error(message);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${SYNC_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response);
  }
  return (await response.json()) as T;
}

// ============ 备份到云端 ============

export async function pushToCloud(customCode?: string): Promise<SyncResult> {
  const startedAt = Date.now();
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

  await postJson('/sync/push', {
    syncCode,
    data: {
      athletes,
      matches,
      matchPlayers,
      rounds,
      roundStats,
      colaLedger,
    } satisfies SyncPayload,
  });

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
  const code = syncCode.trim().toUpperCase();
  if (!code) {
    throw new Error('请输入恢复码');
  }

  const response = await postJson<PullResponse>('/sync/pull', { syncCode: code });
  const {
    athletes,
    matches,
    matchPlayers,
    rounds,
    roundStats,
    colaLedger,
  } = response.data;

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
      await replaceLocalTable(appDb.athletes, athletes);
      await replaceLocalTable(appDb.matches, matches);
      await replaceLocalTable(appDb.matchPlayers, matchPlayers);
      await replaceLocalTable(appDb.rounds, rounds);
      await replaceLocalTable(appDb.roundStats, roundStats);
      await replaceLocalTable(appDb.colaLedger, colaLedger);
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
