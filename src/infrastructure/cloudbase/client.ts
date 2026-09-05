/**
 * Cloudflare Worker 同步 API 地址。
 * 可通过 VITE_SYNC_API_BASE 覆盖；默认走同域相对路径（由 Pages 代理转发）。
 */
export const SYNC_API_BASE =
  (import.meta.env.VITE_SYNC_API_BASE || '').trim();

// 恢复码在 localStorage 中的持久化 key（用于同一设备复用恢复码）
const SYNC_CODE_STORAGE_KEY = 'scoreboard_sync_code';

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
