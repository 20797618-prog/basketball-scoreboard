import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

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
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
