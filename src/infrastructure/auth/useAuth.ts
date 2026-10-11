import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCurrentEmail,
  requestCode,
  verifyCode,
  logout,
  exchangeWorkBuddyToken,
  bindWorkBuddyToken,
} from './authService';
import {
  WECHAT_LOGIN_AVAILABLE,
  handleWorkBuddyCallback,
  signInWithWeChat,
  signOutWorkBuddy,
} from './workbuddy';

export interface AuthState {
  email: string | null;
  busy: boolean;
  msg: string;
  loginEmail: string;
  loginCode: string;
  setLoginEmail: (v: string) => void;
  setLoginCode: (v: string) => void;
  sendCode: () => Promise<void>;
  verify: () => Promise<void>;
  logout: () => void;
  /** 当前环境是否支持微信登录（仅 WorkBuddy 托管域名）。 */
  wechatAvailable: boolean;
  /** 是否有待绑定的微信（需先邮箱登录一次完成绑定）。 */
  wechatPendingBind: boolean;
  wechatLogin: () => Promise<void>;
  bindWechat: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [email, setEmail] = useState<string | null>(getCurrentEmail());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [wechatPendingBind, setWechatPendingBind] = useState(false);

  // 微信令牌只放在内存里，不落 localStorage
  const wbTokenRef = useRef<string | null>(null);

  // 启动即处理微信回跳（必须在任何路由守卫之前）
  useEffect(() => {
    if (!WECHAT_LOGIN_AVAILABLE) return;

    void (async () => {
      const result = await handleWorkBuddyCallback();
      if (!result.handled) return;

      if (result.error) {
        setMsg(`微信登录失败：${result.error}`);
        return;
      }
      if (!result.wbToken) return;

      wbTokenRef.current = result.wbToken;
      try {
        const exchanged = await exchangeWorkBuddyToken(result.wbToken);
        if (exchanged.ok) {
          setEmail(exchanged.email);
          setMsg('微信登录成功。');
          return;
        }
        // 未绑定：提示用邮箱登录一次完成绑定
        setWechatPendingBind(true);
        setMsg('该微信还没绑定账号：请用邮箱验证码登录一次，登录后会自动完成绑定。');
      } catch (err) {
        setMsg(`微信登录失败：${String(err)}`);
      }
    })();
  }, []);

  const sendCode = useCallback(async () => {
    setMsg('');
    setBusy(true);
    try {
      const r = await requestCode(loginEmail);
      if (r.dev && r.code) {
        setMsg(`开发模式：验证码为 ${r.code}`);
      } else {
        setMsg('验证码已发送，请查收邮件。');
      }
    } catch (e) {
      setMsg(`发送失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [loginEmail]);

  const verify = useCallback(async () => {
    setMsg('');
    setBusy(true);
    try {
      const r = await verifyCode(loginEmail, loginCode);
      setEmail(r.email);
      setLoginCode('');

      // 邮箱登录成功且有待绑定微信 → 自动完成一次绑定
      if (wbTokenRef.current) {
        try {
          await bindWorkBuddyToken(wbTokenRef.current);
          wbTokenRef.current = null;
          setWechatPendingBind(false);
          setMsg('微信已绑定成功，下次可直接微信扫码登录。');
        } catch (err) {
          setMsg(`邮箱登录成功，但微信绑定失败：${String(err)}`);
        }
        return;
      }
      setMsg('');
    } catch (e) {
      setMsg(`登录失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [loginEmail, loginCode]);

  const wechatLogin = useCallback(async () => {
    setMsg('');
    const r = await signInWithWeChat();
    if (r.error) setMsg(`微信登录失败：${r.error}`);
  }, []);

  const bindWechat = useCallback(async () => {
    if (!wbTokenRef.current) {
      setMsg('请先点「微信登录」完成授权，再用邮箱登录以完成绑定。');
      return;
    }
    if (!email) {
      setMsg('请先用邮箱验证码登录，再完成微信绑定。');
      return;
    }
    setBusy(true);
    try {
      await bindWorkBuddyToken(wbTokenRef.current);
      wbTokenRef.current = null;
      setWechatPendingBind(false);
      setMsg('微信已绑定成功。');
    } catch (err) {
      setMsg(`绑定失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [email]);

  const doLogout = useCallback(() => {
    logout();
    void signOutWorkBuddy();
    wbTokenRef.current = null;
    setWechatPendingBind(false);
    setEmail(null);
    setMsg('');
  }, []);

  return {
    email,
    busy,
    msg,
    loginEmail,
    loginCode,
    setLoginEmail,
    setLoginCode,
    sendCode,
    verify,
    logout: doLogout,
    wechatAvailable: WECHAT_LOGIN_AVAILABLE,
    wechatPendingBind,
    wechatLogin,
    bindWechat,
  };
}
