/**
 * 托管平台探测：同一份代码要同时跑在 Cloudflare Pages 与 WorkBuddy 托管上。
 *
 * 两边的差异只有两点，全部收敛在本文件里：
 * 1. 路由：Cloudflare Pages 支持 SPA 回退（/match 可直达）；
 *    WorkBuddy 静态托管**没有** history 回退，子路径会 404，必须改用 hash 路由（#/match）。
 * 2. 接口地址：Cloudflare 侧由 public/_worker.js 把 /sync、/api 代理到 Worker，
 *    可以用同域相对路径；WorkBuddy 侧没有代理，必须用 Worker 的绝对地址。
 *
 * 严禁在这里写死业务逻辑；也严禁把这两处差异扩散到其他文件。
 */

/** Cloudflare Worker 的绝对地址（同步 + 账号接口）。 */
export const WORKER_ORIGIN = 'https://scoreboard-sync-api.20797618.workers.dev';

const WORKBUDDY_HOST_SUFFIX = '.app.workbuddy.host';

/** 当前是否运行在 WorkBuddy 托管域名上。 */
export const IS_WORKBUDDY_HOST = (() => {
  if (typeof location === 'undefined') return false;
  const host = location.hostname;
  return host.endsWith(WORKBUDDY_HOST_SUFFIX) || host.endsWith('.workbuddy.link');
})();

/** 是否运行在本地开发环境。 */
export const IS_LOCAL_DEV = (() => {
  if (typeof location === 'undefined') return false;
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
})();

/**
 * 接口基地址。
 * - 构建时可用 VITE_SYNC_API_BASE 覆盖；
 * - WorkBuddy 托管上强制使用 Worker 绝对地址（那边没有同域代理）；
 * - Cloudflare Pages 上保持空字符串，继续走同域相对路径 + Pages 代理。
 */
export const API_BASE = (() => {
  const override = (import.meta.env.VITE_SYNC_API_BASE || '').trim();
  if (override) return override;
  if (IS_WORKBUDDY_HOST) return WORKER_ORIGIN;
  return '';
})();
