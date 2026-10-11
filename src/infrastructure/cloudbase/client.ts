/**
 * Cloudflare Worker 同步 API 地址。
 * - WorkBuddy 托管：使用 Worker 绝对地址（那边没有同域代理）。
 * - Cloudflare Pages：默认空字符串，走同域相对路径（由 Pages 的 _worker.js 代理转发）。
 * - 也可通过 VITE_SYNC_API_BASE 覆盖。
 */
import { API_BASE } from '../platform/hosting';

export const SYNC_API_BASE = API_BASE;
