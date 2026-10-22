import { SYNC_API_BASE } from './client';
import { getToken, getCurrentEmail } from '../auth/authService';
import { appDb } from '../db/appDb';
import type {
  Athlete,
  AthleteClaim,
  ColaLedgerEntry,
  ColaTransfer,
  Match,
  MatchPlayer,
  Round,
  RoundStat,
} from '../../domain/types';
import type { Table } from 'dexie';

/** 同步服务：通过 Cloudflare Worker + D1 完成备份与恢复。数据按登录邮箱隔离。 */

export type SyncDirection = 'push' | 'pull';

export interface SyncResult {
  direction: SyncDirection;
  email: string;
  counts: {
    athletes: number;
    matches: number;
    matchPlayers: number;
    rounds: number;
    roundStats: number;
    colaLedger: number;
    athleteClaims: number;
    colaTransfers: number;
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
  athleteClaims: AthleteClaim[];
  colaTransfers: ColaTransfer[];
}

interface PullResponse {
  data: SyncPayload;
}

/**
 * 合并写入：只按主键 upsert，**不清空本地**。
 *
 * 拉取必须用这个而不是 replaceLocalTable —— 清空再写入会静默销毁
 * 本地尚未上传的数据。曾经因此丢过一整轮比赛（第 5 轮）：
 * 刚录完还没推上去，定时拉取先跑了一遍，本地被清空覆盖。
 *
 * 比赛/轮次/流水都是只增不改或软删除，合并语义不会丢数据；
 * 代价是他端删除的行不会同步过来（本项目不依赖硬删除）。
 */
async function mergeLocalTable<T>(table: Table<T, string>, rows: T[]): Promise<void> {
  if (rows.length === 0) return;
  await table.bulkPut(rows);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error('请先登录');
  }

  const response = await fetch(`${SYNC_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    throw new Error('登录已过期，请重新登录');
  }

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

// ============ 备份到云端 ============

export async function pushToCloud(): Promise<SyncResult> {
  const startedAt = Date.now();
  const email = getCurrentEmail() ?? '';

  const [
    athletes,
    matches,
    matchPlayers,
    rounds,
    roundStats,
    colaLedger,
    athleteClaims,
    colaTransfers,
  ] = await Promise.all([
    appDb.athletes.toArray(),
    appDb.matches.toArray(),
    appDb.matchPlayers.toArray(),
    appDb.rounds.toArray(),
    appDb.roundStats.toArray(),
    appDb.colaLedger.toArray(),
    appDb.athleteClaims.toArray(),
    appDb.colaTransfers.toArray(),
  ]);

  await postJson('/sync/push', {
    data: {
      athletes,
      matches,
      matchPlayers,
      rounds,
      roundStats,
      colaLedger,
      athleteClaims,
      colaTransfers,
    } satisfies SyncPayload,
  });

  return {
    direction: 'push',
    email,
    counts: {
      athletes: athletes.length,
      matches: matches.length,
      matchPlayers: matchPlayers.length,
      rounds: rounds.length,
      roundStats: roundStats.length,
      colaLedger: colaLedger.length,
      athleteClaims: athleteClaims.length,
      colaTransfers: colaTransfers.length,
    },
    startedAt,
    finishedAt: Date.now(),
  };
}

// ============ 从云端恢复 ============

export async function pullFromCloud(options?: { allowEmpty?: boolean }): Promise<SyncResult> {
  const startedAt = Date.now();
  const email = getCurrentEmail() ?? '';

  const response = await postJson<PullResponse>('/sync/pull', {});
  const {
    athletes,
    matches,
    matchPlayers,
    rounds,
    roundStats,
    colaLedger,
    athleteClaims,
    colaTransfers,
  } = response.data;

  // 检查是否真的拉到了数据（避免账号下无数据时本地被清空）
  const totalFetched =
    athletes.length +
    matches.length +
    matchPlayers.length +
    rounds.length +
    roundStats.length +
    colaLedger.length +
    athleteClaims.length +
    colaTransfers.length;
  if (totalFetched === 0) {
    if (options?.allowEmpty) {
      return {
        direction: 'pull',
        email,
        counts: {
          athletes: 0,
          matches: 0,
          matchPlayers: 0,
          rounds: 0,
          roundStats: 0,
          colaLedger: 0,
          athleteClaims: 0,
          colaTransfers: 0,
        },
        startedAt,
        finishedAt: Date.now(),
      };
    }
    throw new Error('该账号下没有云端数据，请先备份');
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
      appDb.athleteClaims,
      appDb.colaTransfers,
    ],
    async () => {
      await mergeLocalTable(appDb.athletes, athletes);
      await mergeLocalTable(appDb.matches, matches);
      await mergeLocalTable(appDb.matchPlayers, matchPlayers);
      await mergeLocalTable(appDb.rounds, rounds);
      await mergeLocalTable(appDb.roundStats, roundStats);
      await mergeLocalTable(appDb.colaLedger, colaLedger);
      await mergeLocalTable(appDb.athleteClaims, athleteClaims);
      await mergeLocalTable(appDb.colaTransfers, colaTransfers);
    },
  );

  return {
    direction: 'pull',
    email,
    counts: {
      athletes: athletes.length,
      matches: matches.length,
      matchPlayers: matchPlayers.length,
      rounds: rounds.length,
      roundStats: roundStats.length,
      colaLedger: colaLedger.length,
      athleteClaims: athleteClaims.length,
      colaTransfers: colaTransfers.length,
    },
    startedAt,
    finishedAt: Date.now(),
  };
}
