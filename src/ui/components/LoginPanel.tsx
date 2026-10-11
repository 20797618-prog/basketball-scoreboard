import type { AuthState } from '../../infrastructure/auth/useAuth';

export function LoginPanel({ auth }: { auth: AuthState }) {
  if (auth.email) {
    return (
      <div className="sync-code-row">
        <span className="sync-code-hint">已登录：{auth.email}</span>
        <button
          className="button button-small button-ghost"
          type="button"
          onClick={auth.logout}
        >
          退出
        </button>
      </div>
    );
  }

  return (
    <div className="login-panel">
      {auth.wechatAvailable ? (
        <>
          <button
            className="button button-wechat"
            type="button"
            onClick={() => void auth.wechatLogin()}
            disabled={auth.busy}
          >
            微信登录
          </button>
          <p className="subtitle login-divider">或使用邮箱验证码登录</p>
        </>
      ) : null}
      <input
        className="text-input"
        type="email"
        placeholder="邮箱（不同账号看到不同数据）"
        value={auth.loginEmail}
        onChange={(e) => auth.setLoginEmail(e.target.value)}
      />
      <div className="inline-actions">
        <input
          className="text-input"
          type="text"
          inputMode="numeric"
          placeholder="6 位验证码"
          value={auth.loginCode}
          onChange={(e) => auth.setLoginCode(e.target.value)}
        />
        <button
          className="button button-small"
          type="button"
          onClick={() => void auth.sendCode()}
          disabled={auth.busy}
        >
          发送验证码
        </button>
      </div>
      <button
        className="button"
        type="button"
        onClick={() => void auth.verify()}
        disabled={auth.busy}
      >
        登录
      </button>
      {auth.wechatPendingBind && auth.email ? (
        <button
          className="button button-small button-ghost"
          type="button"
          onClick={() => void auth.bindWechat()}
          disabled={auth.busy}
        >
          绑定当前微信
        </button>
      ) : null}
      {auth.msg ? <p className="subtitle">{auth.msg}</p> : null}
    </div>
  );
}
