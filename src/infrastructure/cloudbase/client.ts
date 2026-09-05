import cloudbase from '@cloudbase/js-sdk';

/**
 * CloudBase 环境 ID。
 * 部署目标环境：basketballscoreboard-d5a1794da22（体验版，ap-shanghai）
 */
export const CLOUDBASE_ENV_ID = 'basketballscoreboard-d5a1794da22';

// 恢复码在 localStorage 中的持久化 key（用于同一设备复用恢复码）
const SYNC_CODE_STORAGE_KEY = 'scoreboard_sync_code';

// CloudBase 实例（init 返回 cloudbase.app.App；SDK 类型复杂，这里用 any 承载）
let app: any = null;

/** 惰性初始化 CloudBase 应用实例（单例）。 */
function getApp(): any {
  if (!app) {
    app = cloudbase.init({
      env: CLOUDBASE_ENV_ID,
      region: 'ap-shanghai',
    });
  }
  return app;
}

/** 获取关系型数据库实例（PostgreSQL，在完成登录后调用）。 */
export function getRdb(): any {
  return getApp().rdb();
}

/**
 * 匿名登录（幂等）。
 * 注意：匿名身份绑定浏览器本地存储，清缓存后会变成新身份。
 * 但同步不再依赖 uid 隔离（已改用恢复码），登录只为取得 JWT 以访问数据库。
 */
export async function ensureLogin(): Promise<void> {
  const auth = getApp().auth;
  const { data, error } = await auth.signInAnonymously();
  if (error || !data?.user?.id) {
    throw new Error(`CloudBase 匿名登录失败：${error?.message ?? '未知错误'}`);
  }
}

// ============ 恢复码管理 ============

// 默认恢复码：个人自用工具，用简单好记的固定值，用户可以随时改成自己想要的。
const DEFAULT_SYNC_CODE = '123456';

/**
 * 获取当前设备的恢复码（同一浏览器持久复用）。
 * 默认是简单的「123456」，用户可以手动设置成自己想要的码（如 112233）。
 */
export function getOrCreateSyncCode(): string {
  try {
    const cached = localStorage.getItem(SYNC_CODE_STORAGE_KEY);
    if (cached) return cached;
    localStorage.setItem(SYNC_CODE_STORAGE_KEY, DEFAULT_SYNC_CODE);
    return DEFAULT_SYNC_CODE;
  } catch {
    // localStorage 不可用时，返回默认码
    return DEFAULT_SYNC_CODE;
  }
}

/** 手动设置恢复码（用于用户输入已知码来恢复数据）。 */
export function setSyncCode(code: string): void {
  const normalized = code.trim().toUpperCase();
  try {
    localStorage.setItem(SYNC_CODE_STORAGE_KEY, normalized);
  } catch {
    // 忽略
  }
}
