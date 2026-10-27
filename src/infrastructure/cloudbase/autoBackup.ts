/**
 * 自动备份：登录后，本地数据一旦有写入（比赛/可乐/球员等），
 * 防抖几秒后自动把全量数据备份到当前登录邮箱的云端。
 * - 未登录时不做任何事（数据只在本地）。
 * - 拉取恢复（pull）时通过 withAutoBackupSuppressed 抑制，避免循环。
 */
import { appDb } from '../db/appDb';
import { getToken, getCurrentEmail } from '../auth/authService';
import { pushToCloud } from './syncService';

export interface AutoBackupStatus {
  text: string;
  kind: 'info' | 'ok' | 'err';
}

type StatusListener = (s: AutoBackupStatus | null) => void;

const listeners = new Set<StatusListener>();
let lastStatus: AutoBackupStatus | null = null;

function emit(s: AutoBackupStatus | null) {
  lastStatus = s;
  listeners.forEach((fn) => fn(s));
}

export function subscribeAutoBackup(fn: StatusListener): () => void {
  listeners.add(fn);
  fn(lastStatus);
  return () => {
    listeners.delete(fn);
  };
}

const DEBOUNCE_MS = 3000;

let timer: ReturnType<typeof setTimeout> | null = null;
let suppressed = false;
let dirtySince = 0;
/** 最近一次成功推送的时间，用于判断"本地改动是否已经落地到云端"。 */
let lastPushedAt = 0;

/** 本地改动尚未推送到云端的最大等待窗口；超过后不再阻止拉取。 */
const DEFER_WINDOW_MS = 15_000;

/** 是否存在尚未成功推送的本地改动。 */
export function hasUnpushedChanges(): boolean {
  return dirtySince > lastPushedAt;
}

/**
 * 拉取前是否应该让路。
 *
 * 关键：拉取是"合并写入"（bulkPut），会用云端值覆盖同主键的本地行。
 * 如果本地刚改过、还没推上去，此时拉取就会把刚写的改动用旧值覆盖掉
 * —— 曾经因此丢过一次"输家 −1"的结算（账本有了、统计被改回 0）。
 *
 * 若长时间推不上去（网络问题），超过窗口后不再阻止拉取，避免永远不刷新。
 */
export function shouldDeferPull(): boolean {
  if (!hasUnpushedChanges()) return false;
  return Date.now() - dirtySince < DEFER_WINDOW_MS;
}

/** 立即推送（跳过防抖），供拉取前先把本地改动落地。 */
export async function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await run();
}

/** 执行期间忽略数据变更（用于恢复/导入等程序化写入）。 */
export function withAutoBackupSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  suppressed = true;
  return fn().finally(() => {
    suppressed = false;
  });
}

function canAutoBackup(): boolean {
  return !!getCurrentEmail() && !!getToken();
}

function markDirty() {
  if (suppressed) return;
  if (!canAutoBackup()) return;
  dirtySince = Date.now();
  if (!timer) {
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  }
}

async function run() {
  timer = null;
  if (!canAutoBackup()) return;

  const since = dirtySince;
  emit({ text: '自动备份中…', kind: 'info' });
  try {
    const r = await pushToCloud();
    lastPushedAt = Date.now();
    const total =
      r.counts.athletes +
      r.counts.matches +
      r.counts.matchPlayers +
      r.counts.rounds +
      r.counts.roundStats +
      r.counts.colaLedger +
      r.counts.athleteClaims +
      r.counts.colaTransfers;
    const time = new Date().toLocaleTimeString();
    emit({ text: `已自动备份（${time}，共 ${total} 条）`, kind: 'ok' });
  } catch (err) {
    emit({ text: `自动备份失败：${String(err)}`, kind: 'err' });
  } finally {
    // 备份过程中又有新变更，则稍后补一次
    if (dirtySince !== since) {
      scheduleSoon();
    }
  }
}

function scheduleSoon() {
  if (!timer) {
    timer = setTimeout(() => void run(), 1500);
  }
}

let initialized = false;

export function initAutoBackup(): void {
  if (initialized) return;
  initialized = true;

  const tables = [
    'athletes',
    'matches',
    'matchPlayers',
    'rounds',
    'roundStats',
    'colaLedger',
    'athleteClaims',
    'colaTransfers',
  ] as const;
  const hooks = ['creating', 'updating', 'deleting'] as const;

  for (const tableName of tables) {
    const table = (appDb as unknown as Record<string, { hook(name: string, cb: () => void): void }>)[tableName];
    if (!table) continue;
    for (const hookName of hooks) {
      try {
        table.hook(hookName, markDirty);
      } catch {
        // ignore
      }
    }
  }
}
