import { useCallback, useState } from 'react';
import { getCurrentEmail, requestCode, verifyCode, logout } from './authService';

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
}

export function useAuth(): AuthState {
  const [email, setEmail] = useState<string | null>(getCurrentEmail());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');

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
      setMsg('');
    } catch (e) {
      setMsg(`登录失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [loginEmail, loginCode]);

  const doLogout = useCallback(() => {
    logout();
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
  };
}
