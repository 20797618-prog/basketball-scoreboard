import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { IS_WORKBUDDY_HOST } from './infrastructure/platform/hosting';
import './styles.css';

/**
 * 路由模式随托管平台切换：
 * - Cloudflare Pages 支持 SPA 回退，用 BrowserRouter（保留 /match 这类直达链接）。
 * - WorkBuddy 静态托管没有 history 回退，子路径会 404，必须用 HashRouter（#/match）。
 * 业务代码不受影响，两边写法完全一致。
 */
const Router = IS_WORKBUDDY_HOST ? HashRouter : BrowserRouter;

registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('检测到新版本，关闭并重新打开应用后生效。');
  },
  onOfflineReady() {
    console.info('已支持离线使用。');
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
);
