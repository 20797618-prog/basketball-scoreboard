/**
 * 云端刷新：让已登录的客户端定期把云端最新数据拉下来。
 *
 * 背景（这是一个真实发生过的缺陷）：
 * 之前数据的流动是单向的 —— 本地一变就 push（自动备份），但 pull 只发生在
 * 「登录时」和「手动点从云端恢复时」。于是另一个队友在他手机上发起的操作
 * （比如可乐转让申请）虽然已经上传到云端，我这边却永远看不到，
 * 「待我确认」一直是空的。
 *
 * 现在补上拉取这一侧：
 * - 页面重新可见时（切回应用/解锁屏幕）立刻拉一次
 * - 可见状态下每隔一段时间拉一次
 * - 拉取期间抑制自动备份，避免 push/pull 互相触发形成循环
 * - 拉取成功后广播事件，页面据此重新读取本地数据并刷新界面
 */
import { getToken, getCurrentEmail } from '../auth/authService';
import { pullFromCloud } from './syncService';
import { withAutoBackupSuppressed, subscribeAutoBackup, shouldDeferPull, flushNow } from './autoBackup';

/** 数据被云端刷新后的广播事件名。 */
export const DATA_REFRESHED_EVENT = 'scoreboard:data-refreshed';

const POLL_INTERVAL_MS = 60_000;
const MIN_GAP_MS = 8_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastPullAt = 0;
let pulling = false;

function canPull(): boolean {
  return !!getCurrentEmail() && !!getToken();
}

function notify() {
  try {
    window.dispatchEvent(new Event(DATA_REFRESHED_EVENT));
  } catch {
    // ignore
  }
}

async function pullNow(reason: string): Promise<void> {
  if (pulling) return;
  if (!canPull()) return;
  if (Date.now() - lastPullAt < MIN_GAP_MS) return;

  // 本地刚改过、还没推上去：先把改动推上去，这一轮不拉。
  // 否则合并写入会用云端旧值覆盖掉刚写的内容（曾因此丢过一次结算）。
  if (shouldDeferPull()) {
    void flushNow();
    return;
  }
  void reason;

  pulling = true;
  try {
    // 关键：抑制自动备份，否则拉取写入本地会触发 push，形成来回循环
    await withAutoBackupSuppressed(() => pullFromCloud({ allowEmpty: true }));
    lastPullAt = Date.now();
    notify();
  } catch {
    // 网络异常等静默忽略，下一轮再试
  } finally {
    pulling = false;
  }
}

/** 在应用启动时调用一次。 */
export function startCloudRefresh(): void {
  if (started) return;
  started = true;

  // 切回应用立刻拉一次（手机上最常见的情形：切出去看完消息再切回来）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void pullNow('visible');
    }
  });

  timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void pullNow('poll');
    }
  }, POLL_INTERVAL_MS);

  // 自动备份成功后顺带拉一次，保证双机之间快速收敛
  subscribeAutoBackup((status) => {
    if (status?.kind === 'ok') void pullNow('after-push');
  });

  void pullNow('start');
}

export function stopCloudRefresh(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
