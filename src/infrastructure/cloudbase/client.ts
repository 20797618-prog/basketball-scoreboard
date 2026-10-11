/**
 * Cloudflare Worker 同步 API 地址。
 * 可通过 VITE_SYNC_API_BASE 覆盖；默认走同域相对路径（由 Pages 代理转发）。
 */
export const SYNC_API_BASE =
  (import.meta.env.VITE_SYNC_API_BASE || '').trim();
