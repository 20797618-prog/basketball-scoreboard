/**
 * WorkBuddy 微信登录封装。
 *
 * 只在 WorkBuddy 托管域名下生效；Cloudflare Pages 版本完全不受影响（相关入口不显示）。
 *
 * 身份桥流程：
 *   1. 点「微信登录」→ 跳转 WorkBuddy 的 OAuth Relay → 微信扫码
 *   2. 回跳到本应用根路径 → handleWechatWebCallback() 拿到 WorkBuddy 会话
 *   3. 把 WorkBuddy 令牌交给本站 Worker（/api/auth/workbuddy-exchange）换本站会话
 *      - 已绑定过 → 直接登录成功，无需邮箱
 *      - 未绑定过 → 提示先用邮箱验证码登录一次完成绑定（/api/auth/workbuddy-bind）
 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';
import { IS_WORKBUDDY_HOST } from '../platform/hosting';

/** WorkBuddy 应用的公开配置（可安全放在前端；不含任何密钥）。 */
export const WB_PUBLIC_CONFIG = {
  endpoint: 'https://basketball-scoreboard.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_FhMyL3yOJBCHaIZzTiTiSR_mfFS1PqYGuoe9yJpOSwLTBQfRrRiODkL',
} as const;

type CloudClient = {
  auth: {
    getSession: () => Promise<{ data: any; error: any }>;
    getAccessToken: () => Promise<string | null>;
    signOut: () => Promise<any>;
    signInWithOAuth: (opts: { provider: string; redirectTo: string }) => Promise<{ data: any; error: any }>;
    handleWechatWebCallback: () => Promise<{ data: any; error: any }>;
  };
};

let cached: CloudClient | null = null;

/** 取 WorkBuddy 客户端；非 WorkBuddy 托管环境返回 null。 */
export function getWorkBuddyClient(): CloudClient | null {
  if (!IS_WORKBUDDY_HOST) return null;
  if (!cached) {
    cached = createWorkBuddyCloud({
      endpoint: WB_PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: WB_PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: WB_PUBLIC_CONFIG.publishableKey,
    }) as unknown as CloudClient;
  }
  return cached;
}

/** 启动时无条件调用：处理微信回跳（必须在任何路由守卫之前）。 */
export async function handleWorkBuddyCallback(): Promise<{
  handled: boolean;
  wbToken?: string;
  error?: string;
}> {
  const client = getWorkBuddyClient();
  if (!client) return { handled: false };

  try {
    const { data: session, error } = await client.auth.handleWechatWebCallback();
    if (error) return { handled: true, error: String(error.message || error) };
    if (!session) return { handled: false };

    // 登录成功：必须立刻清掉 URL 上的 code/state，否则刷新会重放一次性 code 导致失败
    history.replaceState(null, '', location.pathname + location.hash);

    const token = await client.auth.getAccessToken();
    if (!token) return { handled: true, error: '未能获取 WorkBuddy 访问令牌' };
    return { handled: true, wbToken: token };
  } catch (err) {
    return { handled: true, error: String((err as Error)?.message ?? err) };
  }
}

/** 跳转微信登录（扫码 / 快捷确认由微信侧决定）。 */
export async function signInWithWeChat(): Promise<{ error?: string }> {
  const client = getWorkBuddyClient();
  if (!client) return { error: '当前环境不支持微信登录' };

  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'wechat',
    // 必须是站点根路径：静态托管没有子路径回退，子路径会 404 并丢失 code
    redirectTo: location.origin,
  });
  if (error) return { error: String(error.message || error) };
  location.assign(String(data.url));
  return {};
}

/** 退出 WorkBuddy 会话（本站会话由调用方另行清理）。 */
export async function signOutWorkBuddy(): Promise<void> {
  const client = getWorkBuddyClient();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch {
    // 忽略
  }
}

/** 当前是否可用微信登录（仅在 WorkBuddy 托管域名下）。 */
export const WECHAT_LOGIN_AVAILABLE = IS_WORKBUDDY_HOST;
