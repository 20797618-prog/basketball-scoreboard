const UPSTREAM_SYNC_API = 'https://scoreboard-sync-api.20797618.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/sync/') || url.pathname.startsWith('/api/auth/')) {
      const target = new URL(url.pathname + url.search, UPSTREAM_SYNC_API);
      const proxyRequest = new Request(target.toString(), request);
      return fetch(proxyRequest);
    }

    return env.ASSETS.fetch(request);
  },
};
