/**
 * 账号认证服务：封装 /api/auth/* 接口（由 Pages 代理转发到 Worker）。
 * 会话 token 存于 localStorage，30 天有效。
 */

const TOKEN_KEY = 'scoreboard_auth_token';
const EMAIL_KEY = 'scoreboard_auth_email';

export interface AuthUser {
  email: string;
  hasPassword: boolean;
}

export interface LoginResult {
  token: string;
  email: string;
  hasPassword?: boolean;
  isNewUser?: boolean;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getCurrentEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

function setEmail(email: string | null): void {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    // ignore
  }
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function logout(): void {
  setToken(null);
  setEmail(null);
}

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(
      (data && data.message) || `请求失败（HTTP ${res.status}）`,
    );
  }
  return data as T;
}

/** 发送登录验证码。返回 dev=true 表示开发模式下验证码直接返回。 */
export async function requestCode(
  email: string,
): Promise<{ ok: boolean; dev?: boolean; code?: string }> {
  return api('/api/auth/request-code', { method: 'POST', body: { email } });
}

/** 校验验证码并登录，成功后保存 token。 */
export async function verifyCode(
  email: string,
  code: string,
): Promise<LoginResult> {
  const data = await api<LoginResult>('/api/auth/verify-code', {
    method: 'POST',
    body: { email, code },
  });
  setToken(data.token);
  setEmail(data.email);
  return data;
}

/** 邮箱 + 6 位数字密码登录。 */
export async function loginPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  const data = await api<LoginResult>('/api/auth/login-password', {
    method: 'POST',
    body: { email, password },
  });
  setToken(data.token);
  setEmail(data.email);
  return data;
}

/** 设置/修改 6 位数字密码（需已登录）。 */
export async function setPassword(password: string): Promise<void> {
  await api('/api/auth/set-password', { method: 'POST', body: { password } });
}

/** 校验当前会话，返回登录用户。 */
export async function me(): Promise<{ user: AuthUser }> {
  return api('/api/auth/me');
}
